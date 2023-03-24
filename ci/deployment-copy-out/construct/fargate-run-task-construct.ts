import { Construct } from "constructs";
import { Effect, ManagedPolicy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  Chain,
  Choice,
  Condition,
  CustomState,
  IntegrationPattern,
  JsonPath,
  Map,
  Pass,
  StateMachine,
  Succeed,
  Wait,
  WaitTime,
} from "aws-cdk-lib/aws-stepfunctions";
import { Arn, ArnFormat, Duration, Stack, Tags } from "aws-cdk-lib";
import {
  AssetImage,
  CpuArchitecture,
  FargatePlatformVersion,
  FargateTaskDefinition,
  ICluster,
  LogDriver,
} from "aws-cdk-lib/aws-ecs";
import {
  EcsFargateLaunchTargetOptions,
  EcsLaunchTargetConfig,
  EcsRunTask,
  IEcsLaunchTarget,
  LaunchTargetBindOptions,
} from "aws-cdk-lib/aws-stepfunctions-tasks";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { join } from "path";
import { Service } from "aws-cdk-lib/aws-servicediscovery";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import { Code, Runtime, Function } from "aws-cdk-lib/aws-lambda";
import { CanWriteLambdaStepConstruct } from "./can-write-lambda-step-construct";
import { IVpc, SubnetType } from "aws-cdk-lib/aws-ec2";
import { DistributedMapStepConstruct } from "./distributed-map-step-construct";
import { run } from "node:test";

type Props = {
  fargateCluster: ICluster;
};

export class FargateRunTaskConstruct extends Construct {
  public readonly ecsRunTask: EcsRunTask;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const taskDefinition = new FargateTaskDefinition(this, "Td", {
      runtimePlatform: {
        // FARGATE_SPOT is only available for X86
        cpuArchitecture: CpuArchitecture.X86_64,
      },
      cpu: 256,
      // there is a warning in the rclone documentation about problems with mem < 1GB - but I think that
      // is mainly for large syncs.. we do individual file copies
      memoryLimitMiB: 512,
    });

    Tags.of(taskDefinition).add("test", "tag");

    // we need to give the rclone task the ability to do the copy out in S3
    // TODO can we limit this to reading from our designated buckets and writing out
    taskDefinition.taskRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess")
    );

    const containerDefinition = taskDefinition.addContainer("RcloneContainer", {
      // set the stop timeout to the maximum allowed under Fargate - as potentially this will let us finish
      // our rclone operation
      stopTimeout: Duration.seconds(120),
      image: new AssetImage(
        join(
          __dirname,
          "..",
          "..",
          "..",
          "images",
          "elsa-data-copy-out-rclone-batch-copy-docker-image"
        ),
        {
          // note we are forcing the X86 platform because we want to use Fargate spot which is only available intel/x86
          platform: Platform.LINUX_AMD64,
        }
      ),
      logging: LogDriver.awsLogs({
        streamPrefix: "elsa-data-copy-out",
        logRetention: RetentionDays.ONE_WEEK,
      }),
      environment: {
        RCLONE_CONFIG_S3_TYPE: "s3",
        RCLONE_CONFIG_S3_PROVIDER: "AWS",
        RCLONE_CONFIG_S3_ENV_AUTH: "true",
        RCLONE_CONFIG_S3_REGION: Stack.of(this).region,
      },
    });

    // RCLONE_CONFIG_S3_TYPE=s3 RCLONE_CONFIG_S3_PROVIDER=AWS RCLONE_CONFIG_S3_ENV_AUTH=true RCLONE_CONFIG_S3_REGION=ap-southeast-2 rclone copy src dest

    // https://github.com/aws/aws-cdk/issues/20013
    this.ecsRunTask = new EcsRunTask(this, "Copy File with Rclone", {
      integrationPattern: IntegrationPattern.RUN_JOB,
      cluster: props.fargateCluster,
      taskDefinition: taskDefinition,
      launchTarget: new EcsFargateSpotOnlyLaunchTarget({
        platformVersion: FargatePlatformVersion.VERSION1_4,
      }),
      subnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
      containerOverrides: [
        {
          containerDefinition: containerDefinition,
          command: JsonPath.listAt("$.Items[*].source"),
          environment: [
            {
              name: "destination",
              value: JsonPath.stringAt(
                "$.BatchInput.destinationBucketForRclone"
              ),
            },
          ],
        },
      ],
    });
  }
}

class EcsFargateSpotOnlyLaunchTarget implements IEcsLaunchTarget {
  constructor(private readonly options?: EcsFargateLaunchTargetOptions) {}

  /**
   * Called when the Fargate launch type configured on RunTask
   */
  public bind(
    _task: EcsRunTask,
    launchTargetOptions: LaunchTargetBindOptions
  ): EcsLaunchTargetConfig {
    if (!launchTargetOptions.taskDefinition.isFargateCompatible) {
      throw new Error("Supplied TaskDefinition is not compatible with Fargate");
    }

    return {
      parameters: {
        PlatformVersion: this.options?.platformVersion,
        CapacityProviderStrategy: [
          {
            CapacityProvider: "FARGATE_SPOT",
          },
        ],
        // naughty - this is really nothing to do with LaunchType but this is a way
        // we can set properties in the Steps Run Task ASL
        // in this case we want to be able to track compute used so we propogate
        // through the tags from the task definition (which will come from the Stack/Construct)
        PropagateTags: "TASK_DEFINITION",
      },
    };
  }
}
