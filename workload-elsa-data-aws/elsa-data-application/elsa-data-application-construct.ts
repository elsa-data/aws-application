import {
  aws_ec2 as ec2,
  aws_ecs as ecs,
  CfnOutput,
  Duration,
  Stack,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import { DockerServiceWithHttpsLoadBalancerConstruct } from "../construct/docker-service-with-https-load-balancer-construct";
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { ISecret } from "aws-cdk-lib/aws-secretsmanager";
import { DockerImageCode, DockerImageFunction } from "aws-cdk-lib/aws-lambda";
import {
  ISecurityGroup,
  IVpc,
  SecurityGroup,
  SubnetSelection,
} from "aws-cdk-lib/aws-ec2";
import {
  Cluster,
  ContainerImage,
  CpuArchitecture,
  TaskDefinition,
} from "aws-cdk-lib/aws-ecs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { IHttpNamespace, Service } from "aws-cdk-lib/aws-servicediscovery";
import { IHostedZone } from "aws-cdk-lib/aws-route53";
import { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { ElsaDataApplicationSettings } from "./elsa-data-application-settings";
import { IBucket } from "aws-cdk-lib/aws-s3";

type Props = ElsaDataApplicationSettings & {
  readonly vpc: ec2.IVpc;

  readonly hostedZone: IHostedZone;
  readonly hostedZoneCertificate: ICertificate;

  readonly cloudMapNamespace: IHttpNamespace;

  // The (passwordless and no database name) DSN of our EdgeDb instance as passed to us
  readonly edgeDbDsnNoPassword: string;

  // The secret holding the password of our EdgeDb instance.
  readonly edgeDbPasswordSecret: ISecret;

  // the security group of our edgedb - that we will put ourselves in to enable access
  readonly edgeDbSecurityGroup: ISecurityGroup;

  // the prefix of our infrastructure secrets - so we can set a proper wildcard secret policy
  readonly secretsPrefix: string;

  // an already created temp bucket we can use
  readonly tempBucket: IBucket;
};

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

    this.deployedUrl = `https://${props.urlPrefix}.${props.hostedZone.zoneName}`;

    // we allow our Elsa image to either be the straight Elsa image from the public repo
    // OR we will build a local Dockerfile to allow local changes to be made (config files
    // added etc)
    let containerImage: ContainerImage;

    if (props.buildLocal) {
      // we construct a CDK deployed docker image with any minor alterations
      // we have made to the base image
      const buildLocal = props.buildLocal;

      const asset = new DockerImageAsset(this, "DockerImageAsset", {
        directory: buildLocal.folder,
        platform: Platform.LINUX_AMD64,
        // because the image base name is passed into Docker - the actual Docker checksum
        // itself won't change even when the image base does... so we need to add it into the hash
        extraHash: props.imageBaseName,
        buildArgs: {
          // pass this through to Docker so it can be used as a BASE if wanted
          ELSA_DATA_BASE_IMAGE: props.imageBaseName,
          // bring in custom Docker build values for Elsa to use if present
          ...(buildLocal.version && { ELSA_DATA_VERSION: buildLocal.version }),
          ...(buildLocal.built && { ELSA_DATA_BUILT: buildLocal.built }),
          ...(buildLocal.revision && {
            ELSA_DATA_REVISION: buildLocal.revision,
          }),
        },
      });
      containerImage = ContainerImage.fromDockerImageAsset(asset);
    } else {
      containerImage = ContainerImage.fromRegistry(props.imageBaseName, {});
    }

    const privateServiceWithLoadBalancer =
      new DockerServiceWithHttpsLoadBalancerConstruct(
        this,
        "PrivateServiceWithLb",
        {
          vpc: props.vpc,
          // we need to at least be placed in the EdgeDb security group so that in production we can access EdgeDb
          securityGroups: [props.edgeDbSecurityGroup],
          hostedPrefix: props.urlPrefix,
          hostedZone: props.hostedZone,
          hostedZoneCertificate: props.hostedZoneCertificate,
          containerImage: containerImage,
          memoryLimitMiB: props.memoryLimitMiB ?? 2048,
          cpu: props.cpu ?? 1024,
          desiredCount: props.desiredCount ?? 1,
          cpuArchitecture: CpuArchitecture.X86_64,
          containerName: FIXED_CONTAINER_NAME,
          // NOTE there is a dependence here from the CommandLambda which uses the prefix to extract log messages
          // TODO pass this into the command lambda setup (also FIXED_CONTAINER_NAME)
          logStreamPrefix: "elsa",
          logRetention: RetentionDays.ONE_MONTH,
          healthCheckPath: "/api/health/check",
          environment: {
            // we have a DSN that has no password or database name
            EDGEDB_DSN: props.edgeDbDsnNoPassword,
            // we can choose the database name ourselves or default
            EDGEDB_DATABASE: props.databaseName ?? "edgedb",
            // we don't do EdgeDb certs (our EdgeDb has made self-signed certs) so we must set this
            EDGEDB_CLIENT_TLS_SECURITY: "insecure",
            // environment variables set to setup the meta system for Elsa configuration
            ELSA_DATA_META_CONFIG_FOLDERS:
              props.metaConfigFolders || "./config",
            ELSA_DATA_META_CONFIG_SOURCES: props.metaConfigSources,
            // override any config settings that we know definitively here because of the
            // way we have done the deployment
            ELSA_DATA_CONFIG_DEPLOYED_URL: this.deployedUrl,
            ELSA_DATA_CONFIG_HTTP_HOSTING_PORT: "80",
            ELSA_DATA_CONFIG_AWS_TEMP_BUCKET: props.tempBucket.bucketName,
            ELSA_DATA_CONFIG_SERVICE_DISCOVERY_NAMESPACE:
              props.cloudMapNamespace.namespaceName,
            // only in development are we likely to be using an image that is not immutable
            // i.e. dev we might use "latest".. but in production we should be using "1.0.1" for example
            //  props.isDevelopment ? "default" : "once",
            // until we have everything working - lets leave it at default
            ECS_IMAGE_PULL_BEHAVIOR: "default",
          },
          secrets: {
            EDGEDB_PASSWORD: ecs.Secret.fromSecretsManager(
              props.edgeDbPasswordSecret
            ),
          },
        }
      );

    const policy = new Policy(this, "FargateServiceTaskPolicy");

    // need to be able to fetch secrets - we wildcard to every Secret that has our designated prefix of elsa*
    policy.addStatements(this.getSecretPolicyStatement(props.secretsPrefix));

    // restrict our Get operations to a very specific set of keys in the named buckets
    // NOTE: our 'signing' is always done by a different user so this is not the only
    // permission that has to be set correctly
    for (const [bucketName, keyWildcards] of Object.entries(
      props.awsPermissions.dataBucketPaths
    )) {
      policy.addStatements(
        new PolicyStatement({
          actions: ["s3:GetObject"],
          // NOTE: we could consider restricting to region or account here in constructing the ARNS
          // but given the bucket names are already globally specific we leave them open
          resources: keyWildcards.map(
            (k) => `arn:${Stack.of(this).partition}:s3:::${bucketName}/${k}`
          ),
        })
      );
    }

    policy.addStatements(
      new PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: Object.keys(props.awsPermissions.dataBucketPaths).map(
          (b) => `arn:${Stack.of(this).partition}:s3:::${b}`
        ),
      })
    );

    if (props.awsPermissions.enableAccessPoints) {
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
            `arn:${Stack.of(this).partition}:cloudformation:${
              Stack.of(this).region
            }:${Stack.of(this).account}:stack/elsa-data-*`,
          ],
        })
      );
    }

    // allow starting our steps copy out and any lookup operations we need to perform
    policy.addStatements(
      new PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [
          `arn:${Stack.of(this).partition}:states:${Stack.of(this).region}:${
            Stack.of(this).account
          }:stateMachine:CopyOut*`,
        ],
      }),
      new PolicyStatement({
        actions: [
          "states:StopExecution",
          "states:DescribeExecution",
          "states:ListMapRuns",
        ],
        resources: [
          `arn:${Stack.of(this).partition}:states:${Stack.of(this).region}:${
            Stack.of(this).account
          }:execution:CopyOut*:*`,
        ],
      }),
      new PolicyStatement({
        actions: ["states:DescribeMapRun"],
        resources: [
          `arn:${Stack.of(this).partition}:states:${Stack.of(this).region}:${
            Stack.of(this).account
          }:mapRun:CopyOut*/*:*`,
        ],
      })
    );

    // allow cloudtrail queries to get data egress records
    policy.addStatements(
      new PolicyStatement({
        actions: ["cloudtrail:StartQuery", "cloudtrail:GetQueryResults"],
        resources: ["*"],
      })
    );

    // for some of our scaling out work (Beacon etc) - we are going to make Lambdas that we want to be able to invoke
    // again we wildcard to a designated prefix of elsa-data*
    // TODO parameterise this to not have a magic string
    policy.addStatements(
      new PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [
          `arn:${Stack.of(this).partition}:lambda:${Stack.of(this).region}:${
            Stack.of(this).account
          }:function:elsa-data-*`,
        ],
      })
    );

    // allow discovery
    policy.addStatements(
      new PolicyStatement({
        actions: ["servicediscovery:DiscoverInstances"],
        resources: ["*"],
      })
    );

    // the permissions of the running container (i.e all AWS functionality used by Elsa Data code)
    privateServiceWithLoadBalancer.service.taskDefinition.taskRole.attachInlinePolicy(
      policy
    );

    // 👇 grant access to bucket
    props.tempBucket.grantReadWrite(
      privateServiceWithLoadBalancer.service.taskDefinition.taskRole
    );

    // the command function is an invocable lambda that will then go and spin up an ad-hoc Task in our
    // cluster - we use this for starting admin tasks
    const commandFunction = this.addCommandLambda(
      props.vpc,
      privateServiceWithLoadBalancer.clusterSubnetSelection,
      privateServiceWithLoadBalancer.cluster,
      privateServiceWithLoadBalancer.clusterLogGroup,
      privateServiceWithLoadBalancer.service.taskDefinition,
      [privateServiceWithLoadBalancer.clusterSecurityGroup],
      props.secretsPrefix
    );

    // register a service for the Application in our namespace
    // chose a sensible default - but allow an alteration in case I guess someone might
    // want to run two Elsa *in the same infrastructure*
    const service = new Service(this, "Service", {
      namespace: props.cloudMapNamespace,
      name: props.serviceName ?? "Application",
    });

    // we register it into the cloudmap service so outside tools can locate it
    service.registerNonIpInstance("CommandLambda", {
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
  private getSecretPolicyStatement(secretsPrefix: string): PolicyStatement {
    return new PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [
        `arn:${Stack.of(this).partition}:secretsmanager:${
          Stack.of(this).region
        }:${Stack.of(this).account}:secret:${secretsPrefix}*`,
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
   * @param secretsPrefix
   * @private
   */
  private addCommandLambda(
    vpc: IVpc,
    subnetSelection: SubnetSelection,
    cluster: Cluster,
    clusterLogGroup: LogGroup,
    taskDefinition: TaskDefinition,
    taskSecurityGroups: SecurityGroup[],
    secretsPrefix: string
  ): DockerImageFunction {
    const dockerImageFolder = path.join(
      __dirname,
      "../../artifacts/elsa-data-command-invoke-lambda-docker-image"
    );

    // NOTE whilst we use the VPC information to communicate to the lambda
    // how to execute fargate Tasks - the lambda itself *is not* put inside the VPC
    // (it was taking ages to tear down the CDK stack - and it didn't feel necessary
    //  as it doesn't talk to the databases or anything)

    // this command lambda does almost nothing itself - all it does is trigger the creation of
    // a fargate task and then tracks that to completion - and returns the logs path
    // so it needs very little memory - but up to 14 mins runtime as sometimes the fargate
    // tasks are a bit slow
    const f = new DockerImageFunction(this, "CommandLambda", {
      memorySize: 128,
      code: DockerImageCode.fromImageAsset(dockerImageFolder),
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
          this.getSecretPolicyStatement(secretsPrefix),
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
