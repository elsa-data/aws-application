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
import { Arn, ArnFormat, Stack } from "aws-cdk-lib";
import {
  AssetImage,
  ContainerImage,
  CpuArchitecture,
  FargatePlatformVersion,
  FargateTaskDefinition,
  ICluster,
  LogDriver,
} from "aws-cdk-lib/aws-ecs";
import {
  EcsFargateLaunchTarget,
  EcsRunTask,
} from "aws-cdk-lib/aws-stepfunctions-tasks";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { join } from "path";
import { Service } from "aws-cdk-lib/aws-servicediscovery";

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
      memoryLimitMiB: 512,
    });

    taskDefinition.taskRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess")
    );

    const containerDefinition = taskDefinition.addContainer("AwsCliContainer", {
      //image: ContainerImage.fromRegistry(
      //  "public.ecr.aws/aws-cli/aws-cli:2.11.4"
      //),
      image: new AssetImage(
        join(
          __dirname,
          "..",
          "..",
          "images",
          "elsa-data-copy-out-rclone-docker-image"
        )
      ),
      logging: LogDriver.awsLogs({
        streamPrefix: "elsa-data-copy-out",
        logRetention: RetentionDays.ONE_WEEK,
      }),
      environment: {
        RCLONE_CONFIG_S3_TYPE: "s3",
        RCLONE_CONFIG_S3_PROVIDER: "AWS",
        RCLONE_CONFIG_S3_ENV_AUTH: "true",
      },
    });

    // https://github.com/aws/aws-cdk/issues/20013
    const runTask = new EcsRunTask(this, "Run", {
      integrationPattern: IntegrationPattern.RUN_JOB,
      cluster: props.fargateCluster,
      taskDefinition: taskDefinition,
      launchTarget: new EcsFargateLaunchTarget({
        platformVersion: FargatePlatformVersion.VERSION1_4,
      }),
      containerOverrides: [
        {
          containerDefinition: containerDefinition,
          command: JsonPath.listAt("$.commands"),
        },
      ],
    });

    // This is a workaround from the following issue
    // https://github.com/aws/aws-cdk/issues/23216
    // awaiting native support for a Distributed Map in CDK
    const dummyMap = new Map(this, "DummyMap");
    dummyMap.iterator(runTask);

    const distributedMap = new CustomState(this, "DistributedMap", {
      stateJson: {
        Type: "Map",
        // we need to be careful of the concurrency of the Fargate RunTask..
        // not sure distributed map knows how to handle back-off??
        // https://docs.aws.amazon.com/AmazonECS/latest/userguide/throttling.html
        MaxConcurrency: 100,
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
        //ItemReader: {
        //     Resource: "arn:aws:states:::s3:listObjectsV2",
        //    Parameters: {
        //      Bucket: props.fingerprintBucket.bucketName,
        //      "Prefix.$": "$.fingerprintFolder",
        //    },
        //  },
        ItemBatcher: {
          MaxItemsPerBatch: 2,
          BatchInput: {
            "destinationBucket.$": "$.destinationBucket",
            "relatednessThreshold.$": "$.relatednessThreshold",
            "minimumNCount.$": "$.minimumNCount",
            "fingerprintFolder.$": "$.fingerprintFolder",
            "excludeRegex.$": "$.excludeRegex",
            "expectRelatedRegex.$": "$.expectRelatedRegex",
          },
        },
        ItemProcessor: {
          ...(dummyMap.toStateJson() as any).Iterator,
          ProcessorConfig: {
            Mode: "DISTRIBUTED",
            ExecutionType: "STANDARD",
          },
        },
        ItemSelector: {
          "commands.$": JsonPath.array(
            "copy",
            "--stats-log-level",
            "NOTICE",
            "--checksum",
            JsonPath.format(
              // note: this is not a s3:// URL, it is the peculiar syntax used by rclone
              "s3:{}/{}",
              JsonPath.stringAt("$$.Map.Item.Value.bucket"),
              JsonPath.stringAt("$$.Map.Item.Value.key")
            ),
            JsonPath.format("s3:{}", JsonPath.stringAt("$.destinationBucket"))
          ),
        },
      },
    });

    // NOTE: we use a technique here to allow optional input parameters to the state machine
    // by defining defaults and then JsonMerging them with the actual input params
    this.stateMachine = new StateMachine(this, "StateMachine", {
      definition: distributedMap.next(new Succeed(this, "Succeed")),
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
  protected createLambdaEnv(): {
    [k: string]: string;
  } {
    return {
      SECRET_ARN: "abcd",
    };
  }
}
