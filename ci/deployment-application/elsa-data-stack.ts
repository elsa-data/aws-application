import {
  aws_ecs as ecs,
  aws_route53 as route53,
  Fn,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { EdgeDbConstruct } from "./stack/edge-db-stack";
import { ElsaDataApplicationConstruct } from "./stack/elsa-data-application-construct";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { HttpNamespace, Service } from "aws-cdk-lib/aws-servicediscovery";
import { ElsaDataStackSettings } from "./elsa-data-stack-settings";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import {
  DATABASE_DNS_WITH_TOKENS_NAME,
  HOSTED_ZONE_ID_NAME,
  HOSTED_ZONE_NAME_NAME,
  HOSTED_ZONE_WILDCARD_CERTIFICATE_ARN_NAME,
} from "../../constants";

export class ElsaDataStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps & ElsaDataStackSettings
  ) {
    super(scope, id, props);

    const vpc = Vpc.fromLookup(this, "VPC", {
      vpcId: props.infrastructureVpcId,
      // This is not allowed due to the time of resolution of the fromLookup
      // Could consider https://dev.to/aws-builders/importing-vpc-ids-into-a-stack-with-cdk-27ok
      // vpcId: Fn.importValue(VPC_ID_NAME),
    });

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      "HostedZone",
      {
        hostedZoneId: Fn.importValue(HOSTED_ZONE_ID_NAME),
        zoneName: Fn.importValue(HOSTED_ZONE_NAME_NAME),
      }
    );

    const certificate = Certificate.fromCertificateArn(
      this,
      "SslCert",
      Fn.importValue(HOSTED_ZONE_WILDCARD_CERTIFICATE_ARN_NAME)
    );

    // TODO: clean this up - ideally we would have all the certs in the master Elsa settings secrets
    // const elsaSecret = Secret.fromSecretNameV2(this, "ElsaSecret", "Elsa");
    // https://github.com/aws/containers-roadmap/issues/385

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
        namespaceId: props.serviceRegistration.cloudMapId,
        namespaceName: props.serviceRegistration.cloudMapNamespace,
      }
    );

    const service = new Service(this, "Service", {
      namespace: namespace,
      name: props.serviceRegistration.cloudMapServiceName,
      description: "Service for registering Elsa Data components",
    });

    /**
     * Create Postgres Db and EdgeDb server
     */
    const edgeDb = new EdgeDbConstruct(this, "DatabaseStack", {
      stackName: `elsaDatabaseStack`,
      isDevelopment: props.isDevelopment,
      secretsPrefix: "ElsaData", // pragma: allowlist secret
      baseNetwork: {
        vpc: vpc,
        hostedPrefix: "elsa-edge-db",
        hostedZone: hostedZone,
      },
      edgeDbService: {
        baseDsn: Fn.importValue(DATABASE_DNS_WITH_TOKENS_NAME),
        superUser: "elsa_superuser",
        desiredCount: 1,
        cpu: props.serviceEdgeDb.cpu,
        memory: props.serviceEdgeDb.memoryLimitMiB,
        cert: elsaEdgeDbCert,
        key: elsaEdgeDbKey,
        version: props.serviceEdgeDb.version,
      },
      edgeDbLoadBalancer: {
        port: props.serviceEdgeDb.dbUrlPort || 4000,
        // note we always specify these settings but the UI will only be enabled when props.isDevelopment=true
        ui: {
          port: props.serviceEdgeDb.dbUiUrlPort || 4001,
          certificate: certificate,
        },
      },
    });

    new ElsaDataApplicationConstruct(this, "ElsaData", {
      env: props.env,
      vpc: vpc,
      settings: props.serviceElsaData,
      hostedZoneCertificate: certificate,
      hostedZone: hostedZone,
      cloudMapService: service,
      edgeDbDsnNoPassword: edgeDb.dsnForEnvironmentVariable,
      edgeDbPasswordSecret: edgeDb.edgeDbPasswordSecret,
    });
  }
}
