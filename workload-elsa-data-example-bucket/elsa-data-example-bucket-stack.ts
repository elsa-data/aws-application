import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { CfnEventDataStore } from "aws-cdk-lib/aws-cloudtrail";

/**
 * A stack deploying a bucket and cloudtrail etc that can be used for example data.
 */
export class ElsaDataExampleBucketStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps & { bucketName: string }
  ) {
    super(scope, id, props);

    // Bucket with mock data
    const bucket = new Bucket(this, "Bucket", {
      bucketName: props.bucketName,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
      lifecycleRules: [
        {
          noncurrentVersionExpiration: Duration.days(1),
          enabled: true,
        },
      ],
    });

    // CloudTrail logs
    const cfnEventDataStore = new CfnEventDataStore(
      this,
      "CloudTrailEventDataStore",
      {
        advancedEventSelectors: [
          {
            fieldSelectors: [
              {
                field: "eventCategory",
                equalTo: ["Data"],
              },
              {
                field: "resources.type",
                equalTo: ["AWS::S3::Object"],
              },
              {
                field: "resources.ARN",
                startsWith: [bucket.bucketArn],
              },
              {
                field: "eventName",
                equalTo: ["GetObject"],
              },
            ],

            name: "read-access-s3",
          },
        ],
        multiRegionEnabled: false,
        organizationEnabled: false,
        retentionPeriod: 30, // keep for a month (only for demo)
        terminationProtectionEnabled: false,
      }
    );

    // Output value
    new CfnOutput(this, "CloudTrailLakeArnOutput", {
      value: cfnEventDataStore.attrEventDataStoreArn,
      description: "The ARN for CloudTrail Lake",
      exportName: "CloudTrailLakeArn",
    });
  }
}
