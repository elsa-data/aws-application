import {
  aws_ecs as ecs,
  aws_route53 as route53,
  aws_ssm as ssm,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { EdgeDbStack } from "./stack/edge-db-stack";
import { smartVpcConstruct } from "./construct/vpc";
import { ElsaDataApplicationStack } from "./stack/elsa-data-application-stack";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { HttpNamespace, Service } from "aws-cdk-lib/aws-servicediscovery";
import { ElsaDataStackSettings } from "./elsa-data-stack-settings";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { InstanceClass, InstanceSize, InstanceType } from "aws-cdk-lib/aws-ec2";

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
      props.hostedZoneNameSsm
    );
    const hostedZoneId = ssm.StringParameter.valueFromLookup(
      this,
      props.hostedZoneIdSsm
    );

    const certApse2Arn = StringParameter.valueFromLookup(
      this,
      props.hostedZoneCertificateSsm
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

    const certificate = Certificate.fromCertificateArn(
      this,
      "SslCert",
      certApse2Arn
    );

    /**
     * Create Postgres Db and EdgeDb server
     */
    const edgeDb = new EdgeDbStack(this, "DatabaseStack", {
      stackName: `elsaDatabaseStack`,
      isDevelopment: true,
      secretsPrefix: "ElsaData", // pragma: allowlist secret
      baseNetwork: {
        vpc: vpc,
        hostedPrefix: "elsa-edge-db",
        hostedZone: hostedZone,
      },
      baseDatabase: {
        dbAdminUser: `elsa_admin`,
        dbName: `elsa_database`,
        instanceType: InstanceType.of(
          InstanceClass.BURSTABLE4_GRAVITON,
          InstanceSize.SMALL
        ),
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
        ui: {
          port: 4001,
          certificate: certificate,
        },
      },
    });

    new ElsaDataApplicationStack(this, "ElsaData", {
      env: props.env,
      vpc: vpc,
      hostedPrefix: "elsa",
      hostedZoneCertificate: certificate,
      hostedZone: hostedZone,
      cloudMapService: service,
      edgeDbDsnNoPassword: edgeDb.dsnForEnvironmentVariable,
      edgeDbPasswordSecret: edgeDb.edgeDbPasswordSecret,
    });
  }
}
