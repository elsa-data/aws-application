import {
  aws_ecs as ecs,
  aws_secretsmanager as secretsmanager,
  CfnOutput,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { ElsaDataStackSettings } from "./elsa-data-stack-settings";
import { InfrastructureClient } from "@elsa-data/aws-infrastructure/infrastructure-client";
import { ElsaDataCommandConstruct } from "./command/elsa-data-command-construct";
import { ClusterConstruct } from "./construct/cluster-construct";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { ContainerConstruct } from "./construct/container-construct";
import { TaskDefinitionConstruct } from "./construct/task-definition-construct";
import { CpuArchitecture, FargateService } from "aws-cdk-lib/aws-ecs";
import { ElsaDataApplicationAppRunnerConstruct } from "./app/elsa-data-application-app-runner-construct";
import { ISecurityGroup, SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { IHostedZone } from "aws-cdk-lib/aws-route53";

export {
  ElsaDataStackSettings,
  ElsaDataApplicationSettings,
  ElsaDataApplicationBuildLocal,
  ElsaDataApplicationDatabaseSource,
  ElsaDataApplicationAwsPermissions,
} from "./elsa-data-stack-settings";

/**
 * A stack deploying the Elsa Data application into an existing set of infrastructure.
 */
export class ElsaDataStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps,
    applicationProps: ElsaDataStackSettings
  ) {
    super(scope, id, props);

    // our client unlocks the ability to fetch/create CDK objects that match our
    // installed infrastructure stack (by infrastructure stack name)
    const infraClient = new InfrastructureClient(
      applicationProps.infrastructureStackName
    );

    const vpc = infraClient.getVpcFromLookup(this);

    const namespace = infraClient.getNamespaceFromLookup(this);

    if (!applicationProps.databaseSource.infrastructureDatabaseInstanceName) {
      if (
        !applicationProps.databaseSource.cloudDatabaseSecretName ||
        !applicationProps.databaseSource.cloudDatabaseInstanceName
      )
        throw new Error(
          "If no infrastructure database instance is specified then cloud database secret and cloud database instance must be filled in"
        );
    }

    const edgeDbSecurityGroup: ISecurityGroup | null = applicationProps
      .databaseSource.infrastructureDatabaseInstanceName
      ? infraClient.getEdgeDbSecurityGroupFromLookup(
          this,
          applicationProps.databaseSource.infrastructureDatabaseInstanceName
        )
      : null;

    const edgeDbDsnNoPasswordOrDatabase = applicationProps.databaseSource
      .infrastructureDatabaseInstanceName
      ? infraClient.getEdgeDbDsnNoPasswordOrDatabaseFromLookup(
          this,
          applicationProps.databaseSource.infrastructureDatabaseInstanceName
        )
      : null;

    const edgeDbAdminPasswordSecret = applicationProps.databaseSource
      .infrastructureDatabaseInstanceName
      ? infraClient.getEdgeDbAdminPasswordSecretFromLookup(
          this,
          applicationProps.databaseSource.infrastructureDatabaseInstanceName
        )
      : null;

    const tempBucket = infraClient.getTempBucketFromLookup(this);

    // the cluster is a shared location to run the Elsa Data containers on
    const cluster = new ClusterConstruct(this, "Cluster", {
      vpc: vpc,
      logRetention: RetentionDays.ONE_MONTH,
    });

    if (applicationProps.urlFull && applicationProps.urlPrefix) {
      throw new Error("Only one of urlFull and urlPrefix can be specified");
    }

    let deployedUrl: string;
    let hostedZone: IHostedZone | undefined = undefined;
    let hostedZoneCertificate: ICertificate | undefined = undefined;

    if (applicationProps.urlPrefix) {
      // if url prefix is specified - we expect that the host/certificate is defined by the infrastructure
      // we are deployed into
      const { hostedZone: hz, certificate } =
        infraClient.getDnsFromLookup(this);

      deployedUrl = `https://${applicationProps.urlPrefix}.${hz.zoneName}`;

      hostedZone = hz;
      hostedZoneCertificate = certificate;
    } else {
      // if url full is specified - we expect no DNS is managed by us and all will be
      // done externally
      if (!applicationProps.urlFull?.startsWith("https://"))
        throw new Error("urlFull must start with https://");

      deployedUrl = applicationProps.urlFull;
    }

    if (applicationProps.databaseName === "edgedb")
      throw new Error(
        "Database name cannot be 'edgedb' as that is reserved for other uses"
      );

    const makeEnvironment = (): { [p: string]: string } => {
      const result: { [p: string]: string } = {
        // we can choose the database name ourselves or default it to something sensible
        // for cloud gel this is more important to specify as we share different dbs on the same
        // instance
        GEL_DATABASE: applicationProps.databaseName ?? "elsa_data",

        // deploy as development only if indicated
        NODE_ENV: applicationProps.isDevelopment ? "development" : "production",
        // environment variables set to set up the meta system for Elsa configuration
        ELSA_DATA_META_CONFIG_FOLDERS:
          applicationProps.metaConfigFolders || "./config",
        ELSA_DATA_META_CONFIG_SOURCES: applicationProps.metaConfigSources,
        // override any config settings that we know definitively here because of the
        // way we have done the deployment
        ELSA_DATA_CONFIG_DEPLOYED_URL: deployedUrl,
        ELSA_DATA_CONFIG_HTTP_HOSTING_PORT: "80",
        ELSA_DATA_CONFIG_AWS_TEMP_BUCKET: tempBucket.bucketName,
        ELSA_DATA_CONFIG_SERVICE_DISCOVERY_NAMESPACE: namespace.namespaceName,
        // only in development are we likely to be using an image that is not immutable
        // i.e. dev we might use "latest"... but in production we should be using "1.0.1" for example
        //  props.isDevelopment ? "default" : "once",
        // until we have everything working - lets leave it at default
        ECS_IMAGE_PULL_BEHAVIOR: "default",
      };

      if (applicationProps.databaseSource.infrastructureDatabaseInstanceName) {
        // we have a DSN that has no password or database name
        result["GEL_DSN"] = edgeDbDsnNoPasswordOrDatabase!;
        // we don't do EdgeDb certs (our EdgeDb has made self-signed certs) so we must set this
        result["GEL_CLIENT_TLS_SECURITY"] = "insecure";
      } else {
        result["GEL_INSTANCE"] =
          applicationProps.databaseSource.cloudDatabaseInstanceName!;
      }

      return result;
    };

    // optionally construct a secret to wrap our gel cloud login
    const baseSecret = !applicationProps.databaseSource
      .infrastructureDatabaseInstanceName
      ? secretsmanager.Secret.fromSecretNameV2(
          this,
          "GelCloudSecret",
          applicationProps.databaseSource.cloudDatabaseSecretName!
        )
      : null;

    const makeEcsSecrets = (): { [p: string]: ecs.Secret } => {
      const result: { [p: string]: ecs.Secret } = {};

      if (applicationProps.databaseSource.infrastructureDatabaseInstanceName) {
        result["GEL_PASSWORD"] = ecs.Secret.fromSecretsManager(
          edgeDbAdminPasswordSecret!
        );
      } else {
        result["GEL_SECRET_KEY"] = ecs.Secret.fromSecretsManager(baseSecret!);
      }

      return result;
    };

    // the Elsa Data container is a shared bundling up of the Elsa Data image
    const container = new ContainerConstruct(this, "Container", {
      buildLocal: applicationProps.buildLocal,
      imageBaseName: applicationProps.imageBaseName,
      environment: makeEnvironment(),
      secrets: makeEcsSecrets(),
    });

    new ElsaDataApplicationAppRunnerConstruct(this, "AppRunner", {
      vpc: vpc,
      container: container,
      // depending on the DNS setup these may or may not be present
      hostedZone: hostedZone,
      hostedZoneCertificate: hostedZoneCertificate,
      // this sets the servers concept of where it should live
      deployedUrl: deployedUrl,
      edgeDbSecurityGroup: edgeDbSecurityGroup,
      accessSecretsPolicyStatement:
        infraClient.getSecretPolicyStatementFromLookup(this),
      discoverServicesPolicyStatement:
        infraClient.getCloudMapDiscoveryPolicyStatementFromLookup(this),
      cloudMapNamespace: namespace,
      tempBucket: tempBucket,
      ...applicationProps,
    });

    // the command infrastructure allows us to run admin fargate tasks
    {
      const commandSecurityGroup = new SecurityGroup(
        this,
        "CommandSecurityGroup",
        {
          vpc: vpc,
          allowAllOutbound: true,
        }
      );

      const commandDef = new TaskDefinitionConstruct(this, "CommandDef", {
        cluster: cluster,
        container: container,
        // for commands we definitely need less CPU (we don't really care how long the commands take)
        // and we will see whether we can get away with less memory (we won't be spinning up a web server for instance)
        memoryLimitMiB: 1024,
        cpu: 512,
        environment: makeEnvironment(),
        secrets: makeEcsSecrets(),
        cpuArchitecture: CpuArchitecture.X86_64,
        logStreamPrefix: "elsa-data-command",
      });

      const securityGroups: ISecurityGroup[] = [commandSecurityGroup];

      if (edgeDbSecurityGroup) securityGroups.push(edgeDbSecurityGroup);

      const commandService = new FargateService(this, "CommandService", {
        cluster: cluster.cluster,
        taskDefinition: commandDef.taskDefinition,
        vpcSubnets: cluster.clusterSubnetSelection,
        securityGroups: securityGroups,
        assignPublicIp: false,
      });

      new ElsaDataCommandConstruct(this, "Command", {
        cluster: cluster,
        container: container,
        taskDefinition: commandDef,
        appService: commandService,
        cloudMapNamespace: namespace,
        edgeDbSecurityGroup: edgeDbSecurityGroup,
        accessSecretsPolicyStatement:
          infraClient.getSecretPolicyStatementFromLookup(this),
        tempBucket: tempBucket,
        ...applicationProps,
      });
    }

    new CfnOutput(this, "ElsaDataDeployUrl", {
      value: deployedUrl,
    });
  }
}
