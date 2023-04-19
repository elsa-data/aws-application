import {
  aws_ec2 as ec2,
  aws_ecs as ecs,
  CfnOutput,
  Duration,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import { DockerServiceWithHttpsLoadBalancerConstruct } from "../construct/docker-service-with-https-load-balancer-construct";
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { ISecret } from "aws-cdk-lib/aws-secretsmanager";
import { DockerImageCode, DockerImageFunction } from "aws-cdk-lib/aws-lambda";
import { IVpc, SecurityGroup, SubnetSelection } from "aws-cdk-lib/aws-ec2";
import {
  Cluster,
  ContainerImage,
  CpuArchitecture,
  TaskDefinition,
} from "aws-cdk-lib/aws-ecs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Service } from "aws-cdk-lib/aws-servicediscovery";
import { IHostedZone } from "aws-cdk-lib/aws-route53";
import { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { ElsaDataApplicationStackSettings } from "./elsa-data-application-stack-settings";

interface Props extends StackProps {
  isDevelopment?: boolean;
  vpc: ec2.IVpc;

  hostedZone: IHostedZone;
  hostedZoneCertificate: ICertificate;

  cloudMapService: Service;

  /**
   * The (passwordless) DSN of our EdgeDb instance as passed to us
   * from the EdgeDb stack.
   */
  edgeDbDsnNoPassword: string;

  /**
   * The secret holding the password of our EdgeDb instance.
   */
  edgeDbPasswordSecret: ISecret;

  settings: ElsaDataApplicationStackSettings;
}

// we need a consistent name within the ECS infrastructure for our container
// there seems to be no reason why this would need to be configurable though, hence this constant
const FIXED_CONTAINER_NAME = "ElsaData";

/**
 * The stack for deploying the actual Elsa Data web application.
 */
export class ElsaDataApplicationConstruct extends Construct {
  public deployedUrl: string;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    this.deployedUrl = `https://${props.settings.urlPrefix}.${props.hostedZone.zoneName}`;

    // we allow our Elsa image to either be the straight Elsa image from the public repo
    // OR we will build a local Dockerfile to allow local changes to be made (config files
    // added etc)
    let containerImage: ContainerImage;

    if (props.settings.imageFolder) {
      // we construct a CDK deployed docker image with any minor alterations
      // we have made to the base image
      const asset = new DockerImageAsset(this, "DockerImageAsset", {
        directory: props.settings.imageFolder,
        platform: Platform.LINUX_AMD64,
        buildArgs: {
          ELSA_DATA_BASE_IMAGE: props.settings.imageBaseName,
        },
      });
      containerImage = ContainerImage.fromDockerImageAsset(asset);
    } else {
      containerImage = ContainerImage.fromRegistry(
        props.settings.imageBaseName,
        {}
      );
    }

    const privateServiceWithLoadBalancer =
      new DockerServiceWithHttpsLoadBalancerConstruct(
        this,
        "PrivateServiceWithLb",
        {
          vpc: props.vpc,
          hostedPrefix: props.settings.urlPrefix,
          hostedZone: props.hostedZone,
          hostedZoneCertificate: props.hostedZoneCertificate,
          containerImage: containerImage,
          // rather than have these be settable as props - we should do some study to work out
          // optimal values of these ourselves
          memoryLimitMiB: props.settings.memoryLimitMiB,
          cpu: props.settings.cpu,
          cpuArchitecture: CpuArchitecture.X86_64,
          desiredCount: 1,
          containerName: FIXED_CONTAINER_NAME,
          logStreamPrefix: "elsa",
          logRetention: RetentionDays.ONE_MONTH,
          healthCheckPath: "/api/health/check",
          environment: {
            EDGEDB_DSN: props.edgeDbDsnNoPassword,
            ELSA_DATA_META_CONFIG_FOLDERS:
              props.settings.metaConfigFolders || "./config",
            ELSA_DATA_META_CONFIG_SOURCES: props.settings.metaConfigSources,
            // override any config settings that we know definitively here because of the
            // way we have done the deployment
            ELSA_DATA_CONFIG_DEPLOYED_URL: this.deployedUrl,
            ELSA_DATA_CONFIG_PORT: "80",
            ELSA_DATA_CONFIG_AWS_TEMP_BUCKET: "tempbucket",
            // only in development are we likely to be using an image that is not immutable
            // i.e. dev we might use "latest".. but in production we should be using "1.0.1" for example
            ECS_IMAGE_PULL_BEHAVIOR: props.isDevelopment ? "default" : "once",
          },
          secrets: {
            EDGEDB_PASSWORD: ecs.Secret.fromSecretsManager(
              props.edgeDbPasswordSecret
            ),
          },
        }
      );

    // 👇 grant access to bucket
    //tempBucket.grantReadWrite(
    //  privateServiceWithLoadBalancer.service.taskDefinition.taskRole
    //);

    const policy = new Policy(this, "FargateServiceTaskPolicy");

    // need to be able to fetch secrets - we wildcard to every Secret that has our designated prefix of elsa*
    policy.addStatements(this.getSecretPolicyStatement());

    // for some of our scaling out work (Beacon etc) - we are going to make Lambdas that we want to be able to invoke
    // again we wildcard to a designated prefix of elsa-data*
    policy.addStatements(
      new PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [
          `arn:aws:lambda:${Stack.of(this).region}:${
            Stack.of(this).account
          }:function:elsa-data-*`,
        ],
      })
    );

    // restrict our Get operations to a very specific set of keys in the named buckets
    // NOTE: our 'signing' is always done by a different user so this is not the only
    // permission that has to be set correctly
    for (const [bucketName, keyWildcards] of Object.entries(
      props.settings.awsPermissions.dataBucketPaths
    )) {
      policy.addStatements(
        new PolicyStatement({
          actions: ["s3:GetObject"],
          // NOTE: we could consider restricting to region or account here in constructing the ARNS
          // but given the bucket names are already globally specific we leave them open
          resources: keyWildcards.map((k) => `arn:aws:s3:::${bucketName}/${k}`),
        })
      );
    }

    policy.addStatements(
      new PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: Object.keys(
          props.settings.awsPermissions.dataBucketPaths
        ).map((b) => `arn:aws:s3:::${b}`),
      })
    );

    if (props.settings.awsPermissions.enableAccessPoints) {
      policy.addStatements(
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
        })
      );

      policy.addStatements(
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
        })
      );
    }

    // the permissions of the running container (i.e all AWS functionality used by Elsa Data code)
    privateServiceWithLoadBalancer.service.taskDefinition.taskRole.attachInlinePolicy(
      policy
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
      "../../artifacts/elsa-data-command-invoke-lambda-docker-image"
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
