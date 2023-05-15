import { aws_ecs as ecs, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { EdgeDbConstruct } from "./edge-db/edge-db-stack";
import { ElsaDataApplicationConstruct } from "./elsa-data-application/elsa-data-application-construct";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Service } from "aws-cdk-lib/aws-servicediscovery";
import { ElsaDataStackSettings } from "./elsa-data-stack-settings";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import {
  createDatabaseSecurityGroupFromLookup,
  createDnsFromLookup,
  createNamespaceFromLookup,
  createVpcFromLookup,
} from "./create-from-lookup";
import * as apprunner from "@aws-cdk/aws-apprunner-alpha";
import { ElsaDataApplicationAppRunnerConstruct } from "./elsa-data-application/elsa-data-application-app-runner-construct";

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

    const dbSecurityGroup = createDatabaseSecurityGroupFromLookup(
      this,
      props.infrastructureStackName
    );

    let elsaEdgeDbCert: ecs.Secret | undefined = undefined;
    let elsaEdgeDbKey: ecs.Secret | undefined = undefined;

    if (
      props.serviceEdgeDb.certSecretName &&
      props.serviceEdgeDb.keySecretName
    ) {
      const edgeDbKey = Secret.fromSecretNameV2(
        this,
        "KeySecret",
        props.serviceEdgeDb.keySecretName
      );
      const edgeDbCert = Secret.fromSecretNameV2(
        this,
        "CertSecret",
        props.serviceEdgeDb.certSecretName
      );

      // TODO: clean this up - ideally we would have all the certs in the master Elsa settings secrets
      // const elsaSecret = Secret.fromSecretNameV2(this, "ElsaSecret", "Elsa");
      // https://github.com/aws/containers-roadmap/issues/385
      // ecs.Secret.fromSecretsManager(elsaSecret, "edgeDb.tlsKey");
      elsaEdgeDbCert = ecs.Secret.fromSecretsManager(edgeDbCert);
      elsaEdgeDbKey = ecs.Secret.fromSecretsManager(edgeDbKey);
    }

    const service = new Service(this, "Service", {
      namespace: namespace,
      name: props.serviceRegistration.cloudMapServiceName,
      description: "Service for registering Elsa Data components",
    });

    /**
     * Create EdgeDb server
     */
    const edgeDb = new EdgeDbConstruct(this, "EdgeDb", {
      isDevelopment: props.isDevelopment,
      secretsPrefix: props.serviceEdgeDb.secretPrefix, // pragma: allowlist secret
      baseNetwork: {
        vpc: vpc,
        hostedPrefix: props.serviceEdgeDb.dbUrlPrefix ?? "elsa-edge-db",
        hostedZone: hostedZone,
      },
      edgeDbService: {
        baseSecurityGroup: dbSecurityGroup,
        baseDsn: StringParameter.valueFromLookup(
          this,
          `/${props.infrastructureStackName}/Database/dsnWithPassword`
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
        // only attempt to switch on the UI for development
        ui: props.isDevelopment
          ? {
              port: props.serviceEdgeDb.dbUiUrlPort || 4001,
              certificate: certificate,
              hostedPrefix: "elsa-edge-db",
              hostedZone: hostedZone,
            }
          : undefined,
      },
    });

    new ElsaDataApplicationConstruct(this, "ElsaData", {
      env: props.env,
      vpc: vpc,
      settings: props.serviceElsaData,
      hostedZoneCertificate: certificate!,
      hostedZone: hostedZone,
      cloudMapService: service,
      edgeDbDsnNoPassword: edgeDb.dsnForEnvironmentVariable,
      edgeDbPasswordSecret: edgeDb.edgeDbPasswordSecret,
    });

    new ElsaDataApplicationAppRunnerConstruct(this, "ElsaDataAppRunner", {
      env: props.env,
      vpc: vpc,
      settings: props.serviceElsaData,
      hostedZoneCertificate: certificate!,
      hostedZone: hostedZone,
      cloudMapService: service,
      edgeDbDsnNoPassword: edgeDb.dsnForEnvironmentVariable,
      edgeDbPasswordSecret: edgeDb.edgeDbPasswordSecret,
    });
  }
}
