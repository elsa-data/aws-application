import {
  aws_ec2 as ec2,
  aws_ecs as ecs,
  CfnOutput,
  Duration,
  NestedStack,
  RemovalPolicy,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import { DockerServiceWithHttpsLoadBalancerConstruct } from "../construct/docker-service-with-https-load-balancer-construct";
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { ISecret } from "aws-cdk-lib/aws-secretsmanager";
import { Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { DockerImageCode, DockerImageFunction } from "aws-cdk-lib/aws-lambda";
import { IVpc, SecurityGroup, SubnetSelection } from "aws-cdk-lib/aws-ec2";
import { Cluster, CpuArchitecture, TaskDefinition } from "aws-cdk-lib/aws-ecs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Service } from "aws-cdk-lib/aws-servicediscovery";
import { IHostedZone } from "aws-cdk-lib/aws-route53";
import { ICertificate } from "aws-cdk-lib/aws-certificatemanager";

interface Props extends StackProps {
  vpc: ec2.IVpc;

  urlPrefix: string;

  hostedZone: IHostedZone;
  hostedZoneCertificate: ICertificate;

  cloudMapService: Service;

  /**
   * The (passwordless) DSN of our EdgeDb instance.
   */
  edgeDbDsnNoPassword: string;

  /**
   * The secret holding the password of our EdgeDb instance.
   */
  edgeDbPasswordSecret: ISecret;

  imageFolder: string;
  imageBase: string;

  /**
   * The memory assigned to the Elsa Data fargate
   */
  readonly memoryLimitMiB: number;

  /**
   * The cpu assigned to the Elsa Data fargate
   */
  readonly cpu: number;
}

// we need a consistent name within the ECS infrastructure for our container
// there seems to be no reason why this would need to be configurable though, hence this constant
const FIXED_CONTAINER_NAME = "ElsaData";

/**
 * The stack for deploying the actual Elsa Data web application.
 */
export class ElsaDataApplicationStack extends NestedStack {
  public deployedUrl: string;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    this.deployedUrl = `https://${props.urlPrefix}.${props.hostedZone.zoneName}`;

    // the temp bucket is a useful artifact to allow us to construct S3 objects
    // that we know will automatically cycle/destroy
    const tempBucket = new Bucket(this, "TempBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
      publicReadAccess: false,
      encryption: BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: Duration.days(1),
          expiration: Duration.days(1),
        },
      ],
    });

    // we construct a CDK deployed docker image with any minor alterations
    // we have made to the base image
    const asset = new DockerImageAsset(this, "ElsaDataDockerImage", {
      directory: props.imageFolder,
      platform: Platform.LINUX_AMD64,
      buildArgs: {
        ELSA_DATA_BASE_IMAGE: props.imageBase,
      },
    });

    const privateServiceWithLoadBalancer =
      new DockerServiceWithHttpsLoadBalancerConstruct(
        this,
        "PrivateServiceWithLb",
        {
          vpc: props.vpc,
          hostedPrefix: props.urlPrefix,
          hostedZone: props.hostedZone,
          hostedZoneCertificate: props.hostedZoneCertificate,
          imageAsset: asset,
          // rather than have these be settable as props - we should do some study to work out
          // optimal values of these ourselves
          memoryLimitMiB: props.memoryLimitMiB,
          cpu: props.cpu,
          cpuArchitecture: CpuArchitecture.X86_64,
          desiredCount: 1,
          containerName: FIXED_CONTAINER_NAME,
          logStreamPrefix: "elsa",
          logRetention: RetentionDays.ONE_MONTH,
          healthCheckPath: "/",
          environment: {
            EDGEDB_DSN: props.edgeDbDsnNoPassword,
            // note the 'extra-config' path comes from our custom Docker image we build - with a folder path where we put custom configs
            ELSA_DATA_META_CONFIG_FOLDERS: "./config:/extra-config",
            ELSA_DATA_META_CONFIG_SOURCES:
              "file('base') file('dev-common') file('dev-deployed') file('datasets') aws-secret('ElsaDataDevDeployed')",
            // override any file based setting of the deployed url
            ELSA_DATA_CONFIG_DEPLOYED_URL: this.deployedUrl,
            ELSA_DATA_CONFIG_PORT: "80",
            ELSA_DATA_CONFIG_AWS_TEMP_BUCKET: tempBucket.bucketName,
          },
          secrets: {
            EDGEDB_PASSWORD: ecs.Secret.fromSecretsManager(
              props.edgeDbPasswordSecret
            ),
          },
        }
      );

    // 👇 grant access to bucket
    tempBucket.grantReadWrite(
      privateServiceWithLoadBalancer.service.taskDefinition.taskRole
    );

    // the permissions of the running container (i.e all AWS functionality used by Elsa Data code)
    privateServiceWithLoadBalancer.service.taskDefinition.taskRole.attachInlinePolicy(
      new Policy(this, "FargateServiceTaskPolicy", {
        statements: [
          // need to be able to fetch secrets - we wildcard to everything with our designated prefix
          this.getSecretPolicyStatement(),
          new PolicyStatement({
            actions: ["s3:GetObject"],
            resources: [
              `arn:aws:s3:::agha-gdr-store-2.0/Cardiac/*/manifest.txt`,
            ],
          }),
          // temporarily give all S3 accesspoint perms - can we tighten?
          new PolicyStatement({
            actions: [
              "s3:CreateAccessPoint",
              "s3:DeleteAccessPoint",
              "s3:DeleteAccessPointPolicy",
              "s3:GetAccessPoint",
              "s3:GetAccessPointPolicy",
              "s3:GetAccessPointPolicyStatus",
              "s3:ListAccessPoints",
              "s3:PutAccessPointPolicy",
              "s3:PutAccessPointPublicAccessBlock",
            ],
            resources: [`*`],
          }),
          // need to be able to invoke lambdas
          new PolicyStatement({
            actions: ["lambda:InvokeFunction"],
            resources: [
              `arn:aws:lambda:${Stack.of(this).region}:${
                Stack.of(this).account
              }:function:elsa-data-*`,
            ],
          }),
          // access points need the ability to do CloudFormation
          // TODO: tighten the policy on the CreateStack as that is a powerful function
          //     possibly restrict the source of the template url
          //     possibly restrict the user enacting the CreateStack to only them to create access points
          new PolicyStatement({
            actions: [
              "cloudformation:CreateStack",
              "cloudformation:DescribeStacks",
              "cloudformation:DeleteStack",
            ],
            resources: [
              `arn:aws:cloudformation:${Stack.of(this).region}:${
                Stack.of(this).account
              }:stack/elsa-data-*`,
            ],
          }),
        ],
      })
    );

    // the command function is an invocable lambda that will then go and spin up an ad-hoc Task in our
    // cluster - we use this for starting admin tasks
    const commandFunction = this.addCommandLambda(
      props.vpc,
      privateServiceWithLoadBalancer.clusterSubnetSelection,
      privateServiceWithLoadBalancer.cluster,
      privateServiceWithLoadBalancer.clusterLogGroup,
      privateServiceWithLoadBalancer.service.taskDefinition,
      [privateServiceWithLoadBalancer.clusterSecurityGroup]
    );

    // we register it into the cloudmap service so outside tools can locate it
    props.cloudMapService.registerNonIpInstance("CommandLambda", {
      customAttributes: {
        lambdaArn: commandFunction.functionArn,
      },
    });

    new CfnOutput(this, "ElsaDataDeployUrl", {
      value: this.deployedUrl,
    });
  }

  /**
   * A policy statement that we can use that gives access only to
   * known Elsa Data secrets (by naming convention).
   *
   * @private
   */
  private getSecretPolicyStatement(): PolicyStatement {
    return new PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [
        `arn:aws:secretsmanager:${Stack.of(this).region}:${
          Stack.of(this).account
        }:secret:ElsaData*`,
      ],
    });
  }

  /**
   * Add a command lambda that can start Elsa Data tasks in the cluster for the purposes of
   * executing Elsa Data docker commands.
   *
   * @param vpc
   * @param subnetSelection
   * @param cluster
   * @param clusterLogGroup
   * @param taskDefinition
   * @param taskSecurityGroups
   * @private
   */
  private addCommandLambda(
    vpc: IVpc,
    subnetSelection: SubnetSelection,
    cluster: Cluster,
    clusterLogGroup: LogGroup,
    taskDefinition: TaskDefinition,
    taskSecurityGroups: SecurityGroup[]
  ): DockerImageFunction {
    const commandLambdaSecurityGroup = new SecurityGroup(
      this,
      "CommandLambdaSecurityGroup",
      {
        vpc: vpc,
        // this needs outbound to be able to make the AWS calls it needs (don't want to add PrivateLink)
        allowAllOutbound: true,
      }
    );

    const dockerImageFolder = path.join(
      __dirname,
      "../../../images/elsa-data-command-invoke-lambda-docker-image"
    );

    // this command lambda does almost nothing itself - all it does is trigger the creation of
    // a fargate task and then tracks that to completion - and returns the logs path
    // so it needs very little memory - but up to 14 mins runtime as sometimes the fargate
    // tasks are a bit slow
    const f = new DockerImageFunction(this, "CommandLambda", {
      memorySize: 128,
      code: DockerImageCode.fromImageAsset(dockerImageFolder),
      vpcSubnets: subnetSelection,
      vpc: vpc,
      securityGroups: [commandLambdaSecurityGroup],
      timeout: Duration.minutes(14),
      environment: {
        CLUSTER_ARN: cluster.clusterArn,
        CLUSTER_LOG_GROUP_NAME: clusterLogGroup.logGroupName,
        TASK_DEFINITION_ARN: taskDefinition.taskDefinitionArn,
        CONTAINER_NAME: FIXED_CONTAINER_NAME,
        // we are passing to the lambda the subnets and security groups that need to be used
        // by the Fargate task it will invoke
        SUBNETS: vpc
          .selectSubnets(subnetSelection)
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
          this.getSecretPolicyStatement(),
          // restricted to running our task only on our cluster
          new PolicyStatement({
            actions: ["ecs:RunTask"],
            resources: [taskDefinition.taskDefinitionArn],
            conditions: {
              ArnEquals: {
                "ecs:Cluster": cluster.clusterArn,
              },
            },
          }),
          // restricted to describing tasks only on our cluster
          new PolicyStatement({
            actions: ["ecs:DescribeTasks"],
            resources: ["*"],
            conditions: {
              ArnEquals: {
                "ecs:Cluster": cluster.clusterArn,
              },
            },
          }),
          // give the ability to invoke the task
          new PolicyStatement({
            actions: ["iam:PassRole"],
            resources: [
              taskDefinition.executionRole?.roleArn!,
              taskDefinition.taskRole.roleArn!,
            ],
          }),
        ],
      })
    );

    return f;
  }
}
