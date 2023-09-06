import { Duration, Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { ISecurityGroup } from "aws-cdk-lib/aws-ec2";
import { INamespace, Service } from "aws-cdk-lib/aws-servicediscovery";
import { ElsaDataApplicationSettings } from "../elsa-data-application-settings";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { join } from "path";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { ClusterConstruct } from "../construct/cluster-construct";
import { ContainerConstruct } from "../construct/container-construct";
import { TaskDefinitionConstruct } from "../construct/task-definition-construct";
import { FargateService } from "aws-cdk-lib/aws-ecs";
import { getPolicyStatementsFromDataBucketPaths } from "../helper/bucket-names-to-policy";

interface Props extends ElsaDataApplicationSettings {
  readonly cluster: ClusterConstruct;

  readonly container: ContainerConstruct;

  readonly taskDefinition: TaskDefinitionConstruct;

  readonly appService: FargateService;

  readonly cloudMapNamespace: INamespace;

  // the security group of our edgedb - that we will put ourselves in to enable access
  readonly edgeDbSecurityGroup: ISecurityGroup;

  // a policy statement that we need to add to our running cloudMapService in order to give us access to the secrets
  readonly accessSecretsPolicyStatement: PolicyStatement;

  // an already created temp bucket we can use
  readonly tempBucket: IBucket;
}

/**
 * A construct that allows administration commands to be performed
 * on the Elsa application and database. i.e. perform a migration.
 * It uses the same Elsa Data docker image as the actual web app, but
 * is invoked differently.
 */
export class ElsaDataCommandConstruct extends Construct {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const policy = new Policy(this, "FargateCommandTaskPolicy");

    // need to be able to fetch secrets - we wildcard to every Secret that has our designated prefix of elsa*
    policy.addStatements(props.accessSecretsPolicyStatement);

    // we give the command broad access to the data for the purposes of generating dataset
    policy.addStatements(
      ...getPolicyStatementsFromDataBucketPaths(
        Stack.of(this).partition,
        props.awsPermissions.dataBucketPaths
      )
    );

    // allow the command Elsa's to do arbitrary things to tasks in the same cluster
    // TODO tighten this perhaps to *only* the Elsa Data service
    policy.addStatements(
      new PolicyStatement({
        actions: ["ecs:*"],
        resources: [props.taskDefinition.taskDefinition.taskDefinitionArn],
        conditions: {
          ArnEquals: {
            "ecs:Cluster": props.cluster.cluster.clusterArn,
          },
        },
      })
    );

    // the permissions of the running container (i.e all AWS functionality used by Elsa Data code)
    props.taskDefinition.taskDefinition.taskRole.attachInlinePolicy(policy);

    // the command function is an invocable lambda that will then go and spin up an ad-hoc Task in our
    // cluster - we use this for starting admin tasks
    const commandFunction = this.addCommandLambda(
      props.cluster,
      props.container,
      props.taskDefinition,
      [props.cluster.clusterSecurityGroup, props.edgeDbSecurityGroup],
      props.accessSecretsPolicyStatement,
      props.appService
    );

    // register a cloudMapService for the Application in our namespace
    // chose a sensible default - but allow an alteration in case I guess someone might
    // want to run two Elsa *in the same infrastructure*
    const commandService = new Service(this, "CloudMapService", {
      namespace: props.cloudMapNamespace,
      name: "Command",
    });

    // we register it into the cloud map namespace so outside CLI tools can locate it
    commandService.registerNonIpInstance("CloudMapLambdaInstance", {
      customAttributes: {
        lambdaArn: commandFunction.functionArn,
      },
    });
  }

  /**
   * Add a command lambda that can start Elsa Data tasks in the cluster for the purposes of
   * executing Elsa Data docker commands.
   *
   * @param cluster
   * @param container
   * @param taskDefinition the TaskDefinition for a task that executes Elsa Data
   * @param taskSecurityGroups
   * @param secretsPolicy
   * @param appService
   * @private
   */
  private addCommandLambda(
    cluster: ClusterConstruct,
    container: ContainerConstruct,
    taskDefinition: TaskDefinitionConstruct,
    taskSecurityGroups: ISecurityGroup[],
    secretsPolicy: PolicyStatement,
    appService: FargateService
  ): Function {
    const entry = join(__dirname, "./command-lambda/index.mjs");

    const f = new NodejsFunction(this, "CommandLambda", {
      entry: entry,
      // note this is *just* the memory to launch the ECS task - so ECS task memory is
      // set elsewhere
      memorySize: 128,
      timeout: Duration.minutes(14),
      // by specifying the precise runtime - the bundler knows exactly what packages are already in
      // the base image - and for us can skip bundling @aws-sdk
      // if we need to move this forward to node 18+ - then we may need to revisit this
      runtime: Runtime.NODEJS_18_X,
      environment: {
        CLUSTER_ARN: cluster.cluster.clusterArn,
        CLUSTER_LOG_GROUP_NAME: cluster.clusterLogGroup.logGroupName,
        TASK_DEFINITION_ARN: taskDefinition.taskDefinition.taskDefinitionArn,
        SERVICE_ARN: appService.serviceArn,
        CONTAINER_NAME: container.containerName,
        // we are passing to the lambda the subnets and security groups that need to be used
        // by the Fargate task it will invoke
        SUBNETS: cluster.vpc
          .selectSubnets(cluster.clusterSubnetSelection)
          .subnets.map((s) => s.subnetId)
          .join(",")!,
        SECURITY_GROUPS: taskSecurityGroups
          .map((sg) => sg.securityGroupId)
          .join(",")!,
      },
    });

    f.role?.attachInlinePolicy(
      new Policy(this, "CommandTasksPolicy", {
        statements: [
          // need to be able to fetch secrets - we wildcard to everything with our designated prefix
          secretsPolicy,
          // restricted to running our task only on our cluster
          new PolicyStatement({
            actions: ["ecs:RunTask"],
            resources: [taskDefinition.taskDefinition.taskDefinitionArn],
            conditions: {
              ArnEquals: {
                "ecs:Cluster": cluster.cluster.clusterArn,
              },
            },
          }),
          // restricted to describing tasks only on our cluster
          new PolicyStatement({
            actions: ["ecs:DescribeTasks"],
            resources: ["*"],
            conditions: {
              ArnEquals: {
                "ecs:Cluster": cluster.cluster.clusterArn,
              },
            },
          }),
          // give the ability to invoke the task
          new PolicyStatement({
            actions: ["iam:PassRole"],
            resources: [
              taskDefinition.taskDefinition.executionRole?.roleArn!,
              taskDefinition.taskDefinition.taskRole.roleArn!,
            ],
          }),
        ],
      })
    );

    return f;
  }
}
