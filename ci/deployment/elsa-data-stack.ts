import { aws_ecs as ecs, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  aws_ec2 as ec2,
  aws_ssm as ssm,
  aws_route53 as route53,
} from "aws-cdk-lib";
import { EdgeDbStack } from "./stack/edge-db-stack";
import { smartVpcConstruct } from "./lib/vpc";
import { ElsaDataApplicationStack } from "./stack/elsa-data-application-stack";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { HttpNamespace, Service } from "aws-cdk-lib/aws-servicediscovery";
import { ElsaDataStackSettings } from "./elsa-data-stack-settings";

export class ElsaDataStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps & ElsaDataStackSettings
  ) {
    super(scope, id, props);

    /**
     * Importing existing UMCCR Resource
     */
    const vpc = smartVpcConstruct(this, "VPC", "main-vpc");
    const hostedZoneName = ssm.StringParameter.valueFromLookup(
      this,
      "/hosted_zone/umccr/name"
    );
    const hostedZoneId = ssm.StringParameter.valueFromLookup(
      this,
      "/hosted_zone/umccr/id"
    );

    const hostedPrefix = "elsa";

    const certApse2Arn = StringParameter.valueFromLookup(
      this,
      "cert_apse2_arn"
    );

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      "HostedZone",
      { hostedZoneId: hostedZoneId, zoneName: hostedZoneName }
    );

    // TODO: clean this up - ideally we would have all the certs in the master Elsa settings secrets
    // const elsaSecret = Secret.fromSecretNameV2(this, "ElsaSecret", "Elsa");

    const edgeDbCa = Secret.fromSecretNameV2(
      this,
      "CaSecret",
      "elsa/tls/rootCA"
    );
    const edgeDbKey = Secret.fromSecretNameV2(
      this,
      "KeySecret",
      "elsa/tls/key"
    );
    const edgeDbCert = Secret.fromSecretNameV2(
      this,
      "CertSecret",
      "elsa/tls/cert"
    );

    const elsaEdgeDbCert = ecs.Secret.fromSecretsManager(edgeDbCert);
    const elsaEdgeDbKey = ecs.Secret.fromSecretsManager(edgeDbKey); // ecs.Secret.fromSecretsManager(elsaSecret, "edgeDb.tlsKey");

    // we want to register various aspects of the services we construct into a CloudMap
    // namespace so they are available to other tools
    const namespace = HttpNamespace.fromHttpNamespaceAttributes(
      this,
      "Namespace",
      {
        // this is a bug in the CDK definitions - this field is optional but not defined that way
        // passing an empty string does work
        namespaceArn: "",
        // this is also a bug? surely we should be able to look up a namespace just by name
        namespaceId: props.cloudMapId,
        namespaceName: props.cloudMapNamespace,
      }
    );

    const service = new Service(this, "Service", {
      namespace: namespace,
      name: props.cloudMapServiceName,
      description: "Service for registering Elsa Data components",
    });

    /**
     * Create Postgres Db and EdgeDb server
     */
    const edgeDb = new EdgeDbStack(this, "DatabaseStack", {
      stackName: `elsaDatabaseStack`,
      vpc: vpc,
      hostedZone: hostedZone,
      config: {
        isDevelopment: true,
        secretsPrefix: "ElsaData", // pragma: allowlist secret
        baseDatabase: {
          dbAdminUser: `elsa_admin`,
          dbName: `elsa_database`,
        },
        edgeDbService: {
          superUser: "elsa_superuser",
          desiredCount: 1,
          cpu: 1024,
          memory: 2048,
          cert: elsaEdgeDbCert,
          key: elsaEdgeDbKey,
        },
        edgeDbLoadBalancer: {
          port: 4000,
          uiPort: 4001,
        },
      },
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
      },
    });

    new ElsaDataApplicationStack(this, "ElsaData", {
      vpc: vpc,
      hostedZoneCertArn: certApse2Arn,
      hostedPrefix: hostedPrefix,
      hostedZoneName: hostedZoneName,
      cloudMapService: service,
      edgeDbDsnNoPassword: edgeDb.dsnForEnvironmentVariable,
      edgeDbPasswordSecret: edgeDb.edgeDbPasswordSecret,
    });
  }
}
