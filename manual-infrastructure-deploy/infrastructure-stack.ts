import {
  aws_secretsmanager as secretsmanager,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { InstanceBaseDatabase } from "./rds/instance-base-database";
import { InstanceType } from "aws-cdk-lib/aws-ec2";
import { smartVpcConstruct } from "./network/vpc";
import { Bucket, BucketEncryption, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import { HostedZone } from "aws-cdk-lib/aws-route53";
import {
  Certificate,
  CertificateValidation,
} from "aws-cdk-lib/aws-certificatemanager";
import {
  DATABASE_DNS_WITH_TOKENS_NAME,
  HOSTED_ZONE_ID_NAME,
  HOSTED_ZONE_NAME_NAME,
  HOSTED_ZONE_WILDCARD_CERTIFICATE_ARN_NAME,
  TEMP_BUCKET_NAME_NAME,
  VPC_ID_NAME,
} from "../constants";

interface Props extends StackProps {
  /**
   * A master control switch that tells us that this infrastructure is destined
   * for an environment that contains only development data. This will
   * control whether databases and buckets 'auto-delete' (for instance). It
   * may change the visibility of some resources (RDS instances) - but should in
   * no way expose any resource insecurely (i.e. they will still need passwords
   * even if the database is in a public subnet).
   *
   * The default assumption if this is not present is that all infrastructure
   * is as locked down as possible.
   */
  isDevelopment?: boolean;

  network: {
    /**
     * Controls the VPC that will be used, defaulted to, or constructed.
     * See vpc.ts.
     */
    readonly vpcNameOrDefaultOrNull: string | "default" | null;
  };

  // the configuration of any DNS associated with *all* applications that will be
  // installed to this infrastructure
  dns?: {
    // specifies a Route 53 zone under our control that we will create
    // a wildcard SSL certificate for
    hostedZoneName: string;
  };

  // the configuration of the postgres instance which will be created
  database?: {
    // type: "serverless" | "instance";
    instanceType: InstanceType;
    dbAdminUser: string;
    dbName: string;
  };

  // a prefix that is used for constructing any AWS secrets (i.e. postgres password)
  // if empty - the default AWS naming is used (which are decent names but possibly uninformative of which postgres for instance)
  secretsPrefix?: string;
}

export class InfrastructureStack extends Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    this.templateOptions.description =
      "Elsa Data infrastructure stack providing network/database/storage options to applications";

    const vpc = smartVpcConstruct(
      this,
      "VPC",
      props.network.vpcNameOrDefaultOrNull,
      true
    );

    new CfnOutput(this, VPC_ID_NAME, {
      value: vpc.vpcId,
      exportName: VPC_ID_NAME,
    });

    // the temp bucket is a useful artifact to allow us to construct S3 objects
    // that we know will automatically cycle/destroy
    const tempBucket = new Bucket(this, "TempBucket", {
      // note we set this up for DESTROY and autoDeleteObjects, irrespective of isDevelopment - it is *meant* to be a
      // temporary bucket
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
      publicReadAccess: false,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: BucketEncryption.S3_MANAGED,
      // a bucket that can expire objects over different expiration delays depending on prefix
      lifecycleRules: [
        {
          // we have no reasons to allow multipart uploads over long periods
          abortIncompleteMultipartUploadAfter: Duration.days(1),
          // we are actually set to version: false, but no harm setting this
          noncurrentVersionExpiration: Duration.days(1),
        },
        {
          prefix: "1/",
          expiration: Duration.days(1),
        },
        {
          prefix: "7/",
          expiration: Duration.days(7),
        },
        {
          prefix: "30/",
          expiration: Duration.days(30),
        },
        {
          prefix: "90/",
          expiration: Duration.days(90),
        },
      ],
    });

    // we should consider enabling something like this
    // tempBucket.grantPublicAccess("1/public/");
    // tempBucket.grantPublicAccess("7/public/");
    // tempBucket.grantPublicAccess("30/public/");

    new CfnOutput(this, TEMP_BUCKET_NAME_NAME, {
      value: tempBucket.bucketName,
      exportName: TEMP_BUCKET_NAME_NAME,
    });

    if (props.dns) {
      const hz = HostedZone.fromLookup(this, "HostedZone", {
        domainName: props.dns.hostedZoneName,
      });

      const cert = new Certificate(this, "WildcardCertificate", {
        domainName: `*.${props.dns.hostedZoneName}`,
        subjectAlternativeNames: [props.dns.hostedZoneName],
        validation: CertificateValidation.fromDns(hz),
      });

      new CfnOutput(this, HOSTED_ZONE_NAME_NAME, {
        value: hz.zoneName,
        exportName: HOSTED_ZONE_NAME_NAME,
      });

      new CfnOutput(this, HOSTED_ZONE_ID_NAME, {
        value: hz.hostedZoneId,
        exportName: HOSTED_ZONE_ID_NAME,
      });

      new CfnOutput(this, HOSTED_ZONE_WILDCARD_CERTIFICATE_ARN_NAME, {
        value: cert.certificateArn,
        exportName: HOSTED_ZONE_WILDCARD_CERTIFICATE_ARN_NAME,
      });
    }

    if (props.database) {
      // create a new secret for our base database with an autogenerated password
      const baseDbSecret = new secretsmanager.Secret(this, "RdsSecret", {
        description:
          "Secret containing RDS Postgres details such as admin username and password",
        secretName: props.secretsPrefix
          ? `${props.secretsPrefix}RdsSecret`
          : undefined,
        generateSecretString: {
          excludePunctuation: true,
          secretStringTemplate: JSON.stringify({
            username: props.database.dbAdminUser,
            password: "",
          }),
          generateStringKey: "password",
        },
      });

      // NOT TESTED - MIGHT BE USEFUL TO BE ABLE TO SWITCH IN A SERVERLESS DB
      // const baseDb = new ServerlessBaseDatabase(this, "BaseDb", {
      //       isDevelopment: config.isDevelopment,
      //       vpc: vpc,
      //       databaseName: props.config.baseDatabase.dbName,
      //       secret: baseDbSecret,
      //     })

      const baseDb = new InstanceBaseDatabase(this, "RdsInstance", {
        vpc: vpc,
        databaseName: props.database.dbName,
        databaseAdminUser: props.database.dbAdminUser,
        secret: baseDbSecret,
        instanceType: props.database.instanceType,
        destroyOnRemove: props.isDevelopment,
        makePubliclyReachable: props.isDevelopment,
      });

      if (props.isDevelopment) {
        baseDb.connections().allowDefaultPortFromAnyIpv4();
      } else baseDb.connections().allowDefaultPortInternally();

      new CfnOutput(this, DATABASE_DNS_WITH_TOKENS_NAME, {
        value: baseDb.dsnWithTokens,
        exportName: DATABASE_DNS_WITH_TOKENS_NAME,
      });

      new CfnOutput(this, "databaseDsnNoPassword", {
        value: baseDb.dsnNoPassword,
      });

      new CfnOutput(this, "databaseName", {
        value: props.database.dbName,
      });

      new CfnOutput(this, "databaseAdminUser", {
        value: props.database.dbAdminUser,
      });

      new CfnOutput(this, "databaseAdminSecretArn", {
        value: baseDbSecret.secretArn,
      });
    }
  }
}
