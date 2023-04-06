import {
  aws_secretsmanager as secretsmanager,
  Duration,
  RemovalPolicy,
  Stack,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { InstanceBaseDatabase } from "./rds/instance-base-database";
import { smartVpcConstruct } from "./network/vpc";
import { Bucket, BucketEncryption, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import { HostedZone } from "aws-cdk-lib/aws-route53";
import {
  Certificate,
  CertificateValidation,
} from "aws-cdk-lib/aws-certificatemanager";
import { InfrastructureStackProps } from "./infrastructure-stack-props";
import { StringListParameter, StringParameter } from "aws-cdk-lib/aws-ssm";
import { HttpNamespace } from "aws-cdk-lib/aws-servicediscovery";

/**
 * A basic infrastructure stack that supports
 * - vpc/network - either as a new VPC or re-using existing
 * - a namespace
 * - a DNS zone and certificate
 * - a private bucket for temporary objects (with auto expiry)
 * - a postgres database
 */
export class InfrastructureStack extends Stack {
  constructor(scope: Construct, id: string, props: InfrastructureStackProps) {
    super(scope, id, props);

    this.templateOptions.description = props.description;

    const vpc = smartVpcConstruct(
      this,
      "VPC",
      props.network.vpcNameOrDefaultOrNull,
      true
    );

    // https://lzygo1995.medium.com/how-to-share-information-between-stacks-through-ssm-parameter-store-in-cdk-1a64e4e9d83a

    new StringParameter(this, "VpcIdParameter", {
      parameterName: `/${id}/VPC/vpcId`,
      stringValue: vpc.vpcId,
    });

    new StringListParameter(this, "AvailabilityZonesParameter", {
      parameterName: `/${id}/VPC/availabilityZones`,
      stringListValue: vpc.availabilityZones,
    });

    new StringListParameter(this, "PublicSubnetIdsParameter", {
      parameterName: `/${id}/VPC/publicSubnetIds`,
      stringListValue: vpc.publicSubnets.map((a) => a.subnetId),
    });

    new StringListParameter(this, "PublicSubnetRouteTableIdsParameter", {
      parameterName: `/${id}/VPC/publicSubnetRouteTableIds`,
      stringListValue: vpc.publicSubnets.map((a) => a.routeTable.routeTableId),
    });

    new StringListParameter(this, "PrivateSubnetIdsParameter", {
      parameterName: `/${id}/VPC/privateSubnetIds`,
      stringListValue: vpc.privateSubnets.map((a) => a.subnetId),
    });

    new StringListParameter(this, "PrivateSubnetRouteTableIdsParameter", {
      parameterName: `/${id}/VPC/privateSubnetRouteTableIds`,
      stringListValue: vpc.privateSubnets.map((a) => a.routeTable.routeTableId),
    });

    new StringListParameter(this, "IsolatedSubnetIdsParameter", {
      parameterName: `/${id}/VPC/isolatedSubnetIds`,
      stringListValue: vpc.isolatedSubnets.map((a) => a.subnetId),
    });

    new StringListParameter(this, "IsolatedSubnetRouteTableIdsParameter", {
      parameterName: `/${id}/VPC/isolatedSubnetRouteTableIds`,
      stringListValue: vpc.isolatedSubnets.map(
        (a) => a.routeTable.routeTableId
      ),
    });

    // the temp bucket is a useful artifact to allow us to construct S3 objects
    // that we know will automatically cycle/destroy
    const tempPrivateBucket = new Bucket(this, "TempPrivateBucket", {
      // note we set this up for DESTROY and autoDeleteObjects, irrespective of isDevelopment - it is *meant* to be a
      // temporary bucket
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      // for temporary data there is no need to keep multiple versions
      versioned: false,
      // private temporary data
      publicReadAccess: false,
      // we don't expect there to be writes from other accounts
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // aws managed is fine
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

    /*const tempPublicBucket = new Bucket(this, "TempPublicBucket", {
      // note we set this up for DESTROY and autoDeleteObjects, irrespective of isDevelopment - it is *meant* to be a
      // temporary bucket
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
      publicReadAccess: true,
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
    });*/

    new StringParameter(this, "TempPrivateBucketArnParameter", {
      parameterName: `/${id}/TempPrivateBucket/bucketArn`,
      stringValue: tempPrivateBucket.bucketArn,
    });

    new StringParameter(this, "TempPrivateBucketNameParameter", {
      parameterName: `/${id}/TempPrivateBucket/bucketName`,
      stringValue: tempPrivateBucket.bucketName,
    });

    if (props.namespace) {
      const ns = new HttpNamespace(this, "Namespace", {
        name: props.namespace.name,
      });

      new StringParameter(this, "NamespaceNameParameter", {
        parameterName: `/${id}/HttpNamespace/namespaceName`,
        stringValue: ns.namespaceName,
      });

      new StringParameter(this, "NamespaceIdParameter", {
        parameterName: `/${id}/HttpNamespace/namespaceId`,
        stringValue: ns.namespaceId,
      });

      new StringParameter(this, "NamespaceArnParameter", {
        parameterName: `/${id}/HttpNamespace/namespaceArn`,
        stringValue: ns.namespaceArn,
      });
    }

    if (props.dns) {
      const hz = HostedZone.fromLookup(this, "HostedZone", {
        domainName: props.dns.hostedZoneName,
      });

      const cert = new Certificate(this, "WildcardCertificate", {
        domainName: `*.${props.dns.hostedZoneName}`,
        subjectAlternativeNames: [props.dns.hostedZoneName],
        validation: CertificateValidation.fromDns(hz),
      });

      new StringParameter(this, "ZoneNameParameter", {
        parameterName: `/${id}/HostedZone/zoneName`,
        stringValue: hz.zoneName,
      });

      new StringParameter(this, "HostedZoneIdParameter", {
        parameterName: `/${id}/HostedZone/hostedZoneId`,
        stringValue: hz.hostedZoneId,
      });

      new StringParameter(this, "CertificateArnParameter", {
        parameterName: `/${id}/Certificate/certificateArn`,
        stringValue: cert.certificateArn,
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

      // TODO this actually resolves our tokens as it stores it - which is not what
      // new StringParameter(this, "DatabaseDsnWithTokensParameter", {
      //  parameterName: `/${id}/Database/dsnWithTokens`,
      //  stringValue: baseDb.dsnWithTokens,
      //});

      // we want
      new StringParameter(this, "DatabaseDsnWithPasswordParameter", {
        parameterName: `/${id}/Database/dsnWithPassword`,
        stringValue: baseDb.dsnWithTokens,
      });

      new StringParameter(this, "DatabaseDsnNoPasswordParameter", {
        parameterName: `/${id}/Database/dsnNoPassword`,
        stringValue: baseDb.dsnNoPassword,
      });

      new StringParameter(this, "DatabaseHostnameParameter", {
        parameterName: `/${id}/Database/hostname`,
        stringValue: baseDb.hostname,
      });

      new StringParameter(this, "DatabasePortParameter", {
        parameterName: `/${id}/Database/port`,
        stringValue: baseDb.port.toString(),
      });

      new StringParameter(this, "DatabaseDbNameParameter", {
        parameterName: `/${id}/Database/name`,
        stringValue: props.database.dbName,
      });

      new StringParameter(this, "DatabaseDbAdminUserParameter", {
        parameterName: `/${id}/Database/adminUser`,
        stringValue: props.database.dbAdminUser,
      });

      new StringParameter(this, "DatabaseDbAdminSecretArnParameter", {
        parameterName: `/${id}/Database/adminPasswordSecretArn`,
        stringValue: baseDbSecret.secretArn,
      });
    }
  }
}
