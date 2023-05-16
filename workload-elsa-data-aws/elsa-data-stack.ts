import { Stack, StackProps } from "aws-cdk-lib";
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

export class ElsaDataStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps & ElsaDataStackSettings
  ) {
    super(scope, id, {
      ...props,
      ...(props.forceDeployment && { description: `${new Date()}` }),
    });

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

    const edgeDbAdminPasswordSecretArn = StringParameter.valueFromLookup(
      this,
      `/${props.infrastructureStackName}/Database/${props.infrastructureDatabaseName}/EdgeDb/adminPasswordSecretArn`
    );

    // grrrr... https://github.com/josephedward/aws-cdk/commit/33030e0c2bb46fa909540bff6ae0153d48abc9c2
    let secretArnLookupValue: string;
    if (edgeDbAdminPasswordSecretArn.includes("dummy-value")) {
      secretArnLookupValue = this.formatArn({
        service: "secretsmanager",
        resource: "secret",
        resourceName: "adminPasswordSecret",
      });
    } else {
      secretArnLookupValue = edgeDbAdminPasswordSecretArn;
    }

    const edgeDbAdminPasswordSecret = Secret.fromSecretCompleteArn(
      this,
      "AdminSecret",
      secretArnLookupValue
    );

    const secretsPrefix = StringParameter.valueFromLookup(
      this,
      `/${props.infrastructureStackName}/SecretsManager/secretsPrefix`
    );

    const tempBucketArn = StringParameter.valueFromLookup(
      this,
      `/${props.infrastructureStackName}/TempPrivateBucket/bucketArn`
    );

    let bucketArnLookupValue: string;
    if (tempBucketArn.includes("dummy-value")) {
      bucketArnLookupValue = this.formatArn({
        service: "s3",
        resource: "a-bucket",
      });
    } else {
      bucketArnLookupValue = tempBucketArn;
    }

    const tempBucket = Bucket.fromBucketArn(
      this,
      "TempBucket",
      bucketArnLookupValue
    );

    new ElsaDataApplicationConstruct(this, "ElsaData", {
      env: props.env,
      vpc: vpc,
      settings: props.serviceElsaData,
      hostedZoneCertificate: certificate!,
      hostedZone: hostedZone,
      cloudMapNamespace: namespace,
      edgeDbDsnNoPassword: edgeDbDnsNoPassword,
      edgeDbPasswordSecret: edgeDbAdminPasswordSecret,
      edgeDbSecurityGroup: edgeDbSecurityGroup,
      secretsPrefix: secretsPrefix,
      tempBucket: tempBucket,
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
