import { ArnComponents, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { ElsaDataApplicationConstruct } from "./elsa-data-application/elsa-data-application-construct";
import { ElsaDataStackSettings } from "./elsa-data-stack-settings";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { ElsaDataInfrastructureClient } from "@umccr/elsa-data-aws-infrastructure-client";

export {
  ElsaDataStackSettings,
  ElsaDataApplicationSettings,
  ElsaDataApplicationBuildLocal,
  ElsaDataApplicationAwsPermissions,
} from "./elsa-data-stack-settings";

/**
 * A stack deploying the Elsa Data application into an existing set of infrastructure.
 */
export class ElsaDataStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps,
    applicationProps: ElsaDataStackSettings
  ) {
    super(scope, id, props);

    /**
     * Workaround for a problem with CDK that on initial pass the values of a valueFromLookup
     * are not valid ARNS - which then causes other code to fail - even though eventually the
     * value *will* be a real ARN.
     *
     * See https://github.com/josephedward/aws-cdk/commit/33030e0c2bb46fa909540bff6ae0153d48abc9c2
     *
     * @param parameterName
     * @param dummyComponents
     */
    const delayedArnLookupHelper = (
      parameterName: string,
      dummyComponents: ArnComponents
    ): string => {
      // attempt to get the value from CDK - this might be a dummy value however
      const lookupValue = StringParameter.valueFromLookup(this, parameterName);

      let returnLookupValue: string;
      if (lookupValue.includes("dummy-value")) {
        // if dummy value - need to return a plausible ARN
        returnLookupValue = this.formatArn(dummyComponents);
      } else {
        // else eventually return the real value
        returnLookupValue = lookupValue;
      }

      return returnLookupValue;
    };

    const infraClient = new ElsaDataInfrastructureClient(
      applicationProps.infrastructureStackName
    );

    const vpc = infraClient.getVpcFromLookup(this);

    const namespace = infraClient.getNamespaceFromLookup(this);

    const { hostedZone, certificate } = infraClient.getDnsFromLookup(this);

    const edgeDbSecurityGroup = infraClient.getEdgeDbSecurityGroupFromLookup(
      this,
      applicationProps.infrastructureDatabaseName
    );

    const edgeDbDnsNoPassword = StringParameter.valueFromLookup(
      this,
      `/${applicationProps.infrastructureStackName}/Database/${applicationProps.infrastructureDatabaseName}/EdgeDb/dsnNoPasswordOrDatabase`
    );

    const edgeDbAdminPasswordSecret = Secret.fromSecretCompleteArn(
      this,
      "AdminSecret",
      delayedArnLookupHelper(
        `/${applicationProps.infrastructureStackName}/Database/${applicationProps.infrastructureDatabaseName}/EdgeDb/adminPasswordSecretArn`,
        {
          service: "secretsmanager",
          resource: "secret",
          resourceName: "adminPasswordSecretThoughThisIsNotReal",
        }
      )
    );

    const tempBucket = Bucket.fromBucketArn(
      this,
      "TempBucket",
      delayedArnLookupHelper(
        `/${applicationProps.infrastructureStackName}/TempPrivateBucket/bucketArn`,
        {
          service: "s3",
          resource: "a-bucket-name-though-this-is-not-real",
        }
      )
    );

    new ElsaDataApplicationConstruct(this, "ElsaData", {
      vpc: vpc,
      hostedZoneCertificate: certificate!,
      hostedZone: hostedZone,
      cloudMapNamespace: namespace,
      edgeDbDsnNoPassword: edgeDbDnsNoPassword,
      edgeDbPasswordSecret: edgeDbAdminPasswordSecret,
      edgeDbSecurityGroup: edgeDbSecurityGroup,
      accessSecretsPolicyStatement:
        infraClient.getSecretPolicyStatementFromLookup(this),
      tempBucket: tempBucket,
      ...applicationProps,
    });

    /*
      DISABLED - WAITING ON A CDK CONSTRUCT FOR SETTING CNAME OF APPRUNNER
      THEN WE REALLY SHOULD CONSIDER
      new ElsaDataApplicationAppRunnerConstruct(this, "ElsaDataAppRunner", {
      env: props.env,
      vpc: vpc,
      settings: props.serviceElsaData,
      hostedZoneCertificate: certificate!,
      hostedZone: hostedZone,
      cloudMapService: service,
      edgeDbDsnNoPassword: edgeDb.dsnForEnvironmentVariable,
      edgeDbPasswordSecret: edgeDb.edgeDbPasswordSecret,
    });*/
  }
}
