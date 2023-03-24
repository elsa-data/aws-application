import { aws_ecs as ecs, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { EdgeDbConstruct } from "./stack/edge-db-stack";
import { ElsaDataApplicationConstruct } from "./stack/elsa-data-application-construct";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Service } from "aws-cdk-lib/aws-servicediscovery";
import { ElsaDataStackSettings } from "./elsa-data-stack-settings";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { createFromAttributes } from "../../manual-infrastructure-deploy/create-from-attributes";

export class ElsaDataStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps & ElsaDataStackSettings
  ) {
    super(scope, id, props);

    const { vpc, namespace, hostedZone, certificate } = createFromAttributes(
      this,
      props.infrastructureStack
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
        baseDsn: StringParameter.valueFromLookup(
          this,
          `/${props.infrastructureStack}/Database/dsnWithPassword`
        ),
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
