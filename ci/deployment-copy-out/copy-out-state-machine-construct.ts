import { Construct } from "constructs";
import { Effect, ManagedPolicy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  CustomState,
  IntegrationPattern,
  JsonPath,
  Map,
  Pass,
  StateMachine,
  Succeed,
} from "aws-cdk-lib/aws-stepfunctions";
import { Arn, ArnFormat, Duration, Stack } from "aws-cdk-lib";
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

export type CopyOutStateMachineProps = {
  fargateCluster: ICluster;

  namespaceService: Service;
};

export class CopyOutStateMachineConstruct extends Construct {
  private readonly stateMachine: StateMachine;

  constructor(scope: Construct, id: string, props: CopyOutStateMachineProps) {
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
    const runTask = new EcsRunTask(this, "FargateRunTask", {
      integrationPattern: IntegrationPattern.RUN_JOB,
      cluster: props.fargateCluster,
      taskDefinition: taskDefinition,
      launchTarget: new EcsFargateSpotOnlyLaunchTarget({
        platformVersion: FargatePlatformVersion.VERSION1_4,
      }),
      containerOverrides: [
        {
          containerDefinition: containerDefinition,
          command: JsonPath.listAt("$.Items[*].source"),
          environment: [
            {
              name: "destination",
              value: JsonPath.stringAt("$.BatchInput.destinationBucket"),
            },
          ],
        },
      ],
    }).addRetry({
      errors: ["States.TaskFailed"],
      maxAttempts: 2,
    });

    // This is a workaround from the following issue
    // https://github.com/aws/aws-cdk/issues/23216
    // awaiting native support for a Distributed Map in CDK
    // this uses a dummy map in order to generate all the fields we
    // need to iterate over our ECS task
    const dummyMap = new Map(this, "DummyMap");
    dummyMap.iterator(runTask);
    const mapItemProcessor = (dummyMap.toStateJson() as any).Iterator;

    // {
    //     "BatchInput": {
    //         "a": ""
    //     },
    //     "Items": [
    //         {
    //             "bucket": "",
    //             "key": ""
    //         },
    //         {
    //             "bucket": "",
    //             "key": ""
    //         }
    //     ]
    // }

    /*
     {
       "sourceFilesCsvBucket": "umccr-10c-data-dev",
       "sourceFilesCsvKey": "manifest-copy-out-rclone-bucket-key.csv",
       "destinationBucket": "elsa-data-replication-target-foo",
       "maxItemsPerBatch": 10
     }
     */

    const distributedMap = new CustomState(this, "DistributedMap", {
      stateJson: {
        // https://states-language.net/#map-state
        Type: "Map",
        // we need to be careful of the concurrency of the Fargate RunTask..
        // not sure distributed map knows how to handle back-off??
        // https://docs.aws.amazon.com/AmazonECS/latest/userguide/throttling.html
        MaxConcurrency: 100,
        ToleratedFailurePercentage: 25,
        ItemReader: {
          ReaderConfig: {
            InputType: "CSV",
            CSVHeaderLocation: "GIVEN",
            CSVHeaders: ["bucket", "key"],
          },
          Resource: "arn:aws:states:::s3:getObject",
          Parameters: {
            "Bucket.$": "$.sourceFilesCsvBucket",
            "Key.$": "$.sourceFilesCsvKey",
          },
        },
        ItemBatcher: {
          MaxItemsPerBatchPath: JsonPath.stringAt("$.maxItemsPerBatch"),
          BatchInput: {
            "destinationBucket.$": JsonPath.format(
              "s3:{}",
              JsonPath.stringAt("$.destinationBucket")
            ),
          },
        },
        ItemProcessor: {
          ...mapItemProcessor,
          ProcessorConfig: {
            Mode: "DISTRIBUTED",
            ExecutionType: "STANDARD",
          },
        },
        ItemSelector: {
          "source.$": JsonPath.format(
            // note: this is not a s3:// URL, it is the peculiar syntax used by rclone
            "s3:{}/{}",
            JsonPath.stringAt("$$.Map.Item.Value.bucket"),
            JsonPath.stringAt("$$.Map.Item.Value.key")
          ),
        },
      },
    });

    // NOTE: we use a technique here to allow optional input parameters to the state machine
    // by defining defaults and then JsonMerging them with the actual input params
    this.stateMachine = new StateMachine(this, "StateMachine", {
      definition: new Pass(this, "Define Defaults", {
        parameters: {
          maxItemsPerBatch: 1,
        },
        resultPath: "$.inputDefaults",
      })
        .next(
          new Pass(this, "Apply Defaults", {
            // merge default parameters into whatever the user has sent us
            resultPath: "$.withDefaults",
            outputPath: "$.withDefaults.args",
            parameters: {
              "args.$":
                "States.JsonMerge($.inputDefaults, $$.Execution.Input, false)",
            },
          })
        )
        .next(distributedMap)
        .next(new Succeed(this, "Succeed")),
    });

    // this is needed to support distributed map - once there is a native CDK for this I presume this goes
    this.stateMachine.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["states:StartExecution"],
        resources: [
          Arn.format(
            {
              arnFormat: ArnFormat.COLON_RESOURCE_NAME,
              service: "states",
              resource: "stateMachine",
              resourceName: "*",
            },
            Stack.of(this)
          ),
        ],
      })
    );

    // this is needed to support distributed map - once there is a native CDK for this I presume this goes
    this.stateMachine.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["states:DescribeExecution", "states:StopExecution"],
        resources: [
          Arn.format(
            {
              arnFormat: ArnFormat.COLON_RESOURCE_NAME,
              service: "states",
              resource: "execution",
              resourceName: "*" + "/*",
            },
            Stack.of(this)
          ),
        ],
      })
    );

    // this is too broad - but once the CFN native Distributed Map is created - it will handle this for us
    // (I think it isn't doing it because of our DummyMap)
    this.stateMachine.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["lambda:InvokeFunction"],
        resources: ["*"],
      })
    );

    this.stateMachine.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ecs:*", "iam:PassRole"],
        resources: ["*"],
      })
    );

    this.stateMachine.role.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess")
    );
    this.stateMachine.role.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName("CloudWatchEventsFullAccess")
    );

    props.namespaceService.registerNonIpInstance("StateMachine", {
      customAttributes: {
        stateMachineArn: this.stateMachine.stateMachineArn,
      },
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
        PropagateTags: "TASK_DEFINITION",
      },
    };
  }
}
