import { ArnComponents, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { ElsaDataApplicationConstruct } from "./elsa-data-application/elsa-data-application-construct";
import { Service } from "aws-cdk-lib/aws-servicediscovery";
import { ElsaDataStackSettings } from "./elsa-data-stack-settings";
import {
  createDnsFromLookup,
  createEdgeDbSecurityGroupFromLookup,
  createNamespaceFromLookup,
  createVpcFromLookup,
} from "./create-from-lookup";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Bucket } from "aws-cdk-lib/aws-s3";

/**
 * A stack deploying the Elsa Data application into an existing set of infrastructure.
 */
export class ElsaDataStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps & ElsaDataStackSettings
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

    const vpc = createVpcFromLookup(this, props.infrastructureStackName);

    const namespace = createNamespaceFromLookup(
      this,
      props.infrastructureStackName
    );

    const { hostedZone, certificate } = createDnsFromLookup(
      this,
      props.infrastructureStackName
    );

    const edgeDbSecurityGroup = createEdgeDbSecurityGroupFromLookup(
      this,
      props.infrastructureStackName,
      props.infrastructureDatabaseName
    );

    const edgeDbDnsNoPassword = StringParameter.valueFromLookup(
      this,
      `/${props.infrastructureStackName}/Database/${props.infrastructureDatabaseName}/EdgeDb/dsnNoPasswordOrDatabase`
    );

    const edgeDbAdminPasswordSecret = Secret.fromSecretCompleteArn(
      this,
      "AdminSecret",
      delayedArnLookupHelper(
        `/${props.infrastructureStackName}/Database/${props.infrastructureDatabaseName}/EdgeDb/adminPasswordSecretArn`,
        {
          service: "secretsmanager",
          resource: "secret",
          resourceName: "adminPasswordSecretThoughThisIsNotReal",
        }
      )
    );

    const secretsPrefix = StringParameter.valueFromLookup(
      this,
      `/${props.infrastructureStackName}/SecretsManager/secretsPrefix`
    );

    const tempBucket = Bucket.fromBucketArn(
      this,
      "TempBucket",
      delayedArnLookupHelper(
        `/${props.infrastructureStackName}/TempPrivateBucket/bucketArn`,
        {
          service: "s3",
          resource: "a-bucket-name-though-this-is-not-real",
        }
      )
    );

    new ElsaDataApplicationConstruct(this, "ElsaData", {
      vpc: vpc,
      env: props.env,
      hostedZoneCertificate: certificate!,
      hostedZone: hostedZone,
      cloudMapNamespace: namespace,
      edgeDbDsnNoPassword: edgeDbDnsNoPassword,
      edgeDbPasswordSecret: edgeDbAdminPasswordSecret,
      edgeDbSecurityGroup: edgeDbSecurityGroup,
      secretsPrefix: secretsPrefix,
      tempBucket: tempBucket,
      ...props,
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
