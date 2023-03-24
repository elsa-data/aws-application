import { Construct } from "constructs";
import { Effect, ManagedPolicy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  Chain,
  Choice,
  Condition,
  CustomState,
  IChainable,
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

type Props = {
  task: IChainable;
};

export class DistributedMapStepConstruct extends Construct {
  public readonly distributedMapStep: CustomState;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    // This is a workaround from the following issue
    // https://github.com/aws/aws-cdk/issues/23216
    // awaiting native support for a Distributed Map in CDK
    // this uses a dummy map in order to generate all the fields we
    // need to iterate over our ECS task
    const dummyMap = new Map(this, "DummyMap");
    dummyMap.iterator(props.task);
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

    this.distributedMapStep = new CustomState(this, "DistributedMap", {
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
            "destinationBucketForRclone.$": JsonPath.format(
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
  }
}
