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

    // register a service for the Application in our namespace
    const service = new Service(this, "Service", {
      namespace: namespace,
      name: props.serviceRegistration.cloudMapServiceName,
      description: "Service for registering Elsa Data components",
    });

    const edgeDbSecurityGroup = createEdgeDbSecurityGroupFromLookup(
      this,
      props.infrastructureStackName,
      "edge"
    );

    const edgeDbDnsNoPassword = StringParameter.valueFromLookup(
      this,
      `/${props.infrastructureStackName}/Database/${props.infrastructureDatabaseName}/EdgeDb/dsnNoPasswordOrDatabase`
    );

    const edgeDbAdminPasswordSecretArn = StringParameter.valueFromLookup(
      this,
      `/${props.infrastructureStackName}/Database/${props.infrastructureDatabaseName}/EdgeDb/adminPasswordSecretArn`
    );

    const edgeDbAdminPasswordSecret = Secret.fromSecretCompleteArn(
      this,
      "AdminSecret",
      edgeDbAdminPasswordSecretArn
    );

    const secretsPrefix = StringParameter.valueFromLookup(
      this,
      `/${props.infrastructureStackName}/SecretsManager/secretsPrefix`
    );

    const tempBucket = Bucket.fromBucketArn(
      this,
      "TempBucket",
      StringParameter.valueFromLookup(
        this,
        `/${props.infrastructureStackName}/TempPrivateBucket/bucketArn`
      )
    );

    new ElsaDataApplicationConstruct(this, "ElsaData", {
      env: props.env,
      vpc: vpc,
      settings: props.serviceElsaData,
      hostedZoneCertificate: certificate!,
      hostedZone: hostedZone,
      cloudMapService: service,
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
