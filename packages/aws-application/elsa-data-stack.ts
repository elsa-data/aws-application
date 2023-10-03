import { aws_ecs as ecs, CfnOutput, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { ElsaDataStackSettings } from "./elsa-data-stack-settings";
import { InfrastructureClient } from "@elsa-data/aws-infrastructure-client";
import { ElsaDataCommandConstruct } from "./command/elsa-data-command-construct";
import { ClusterConstruct } from "./construct/cluster-construct";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { ContainerConstruct } from "./construct/container-construct";
import { TaskDefinitionConstruct } from "./construct/task-definition-construct";
import { CpuArchitecture, FargateService } from "aws-cdk-lib/aws-ecs";
import { ElsaDataApplicationAppRunnerConstruct } from "./app/elsa-data-application-app-runner-construct";
import { SecurityGroup } from "aws-cdk-lib/aws-ec2";

export {
  ElsaDataStackSettings,
  ElsaDataApplicationSettings,
  ElsaDataApplicationBuildLocal,
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

    const { hostedZone, certificate } = infraClient.getDnsFromLookup(this);

    const edgeDbSecurityGroup = infraClient.getEdgeDbSecurityGroupFromLookup(
      this,
      applicationProps.infrastructureDatabaseInstanceName
    );

    const edgeDbDsnNoPasswordOrDatabase =
      infraClient.getEdgeDbDsnNoPasswordOrDatabaseFromLookup(
        this,
        applicationProps.infrastructureDatabaseInstanceName
      );

    const edgeDbAdminPasswordSecret =
      infraClient.getEdgeDbAdminPasswordSecretFromLookup(
        this,
        applicationProps.infrastructureDatabaseInstanceName
      );

    const tempBucket = infraClient.getTempBucketFromLookup(this);

    // the cluster is a shared location to run the Elsa Data containers on
    const cluster = new ClusterConstruct(this, "Cluster", {
      vpc: vpc,
      logRetention: RetentionDays.ONE_MONTH,
    });

    const deployedUrl = `https://${applicationProps.urlPrefix}.${hostedZone.zoneName}`;

    if (applicationProps.databaseName === "edgedb")
      throw new Error(
        "Database name cannot be 'edgedb' as that is reserved for other uses"
      );

    const makeEnvironment = (): { [p: string]: string } => ({
      // deploy as development only if indicated
      NODE_ENV: applicationProps.isDevelopment ? "development" : "production",
      // we have a DSN that has no password or database name
      EDGEDB_DSN: edgeDbDsnNoPasswordOrDatabase,
      // we can choose the database name ourselves or default it to something sensible
      EDGEDB_DATABASE: applicationProps.databaseName ?? "elsa_data",
      // we don't do EdgeDb certs (our EdgeDb has made self-signed certs) so we must set this
      EDGEDB_CLIENT_TLS_SECURITY: "insecure",
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
    });

    const makeEcsSecrets = (): { [p: string]: ecs.Secret } => ({
      EDGEDB_PASSWORD: ecs.Secret.fromSecretsManager(edgeDbAdminPasswordSecret),
    });

    // the Elsa Data container is a shared bundling up of the Elsa Data image
    const container = new ContainerConstruct(this, "Container", {
      buildLocal: applicationProps.buildLocal,
      imageBaseName: applicationProps.imageBaseName,
      environment: makeEnvironment(),
      secrets: makeEcsSecrets(),
    });

    /*const appDef = new TaskDefinitionConstruct(this, "AppDef", {
      cluster: cluster,
      container: container,
      memoryLimitMiB: applicationProps.memoryLimitMiB ?? 2048,
      cpu: applicationProps.cpu ?? 1024,
      environment: makeEnvironment(),
      secrets: makeEcsSecrets(),
      cpuArchitecture: CpuArchitecture.X86_64,
      logStreamPrefix: "elsa-data-app",
    }); */

    /*
      DISABLED - WAITING ON A CDK CONSTRUCT FOR SETTING CNAME OF APPRUNNER
      THEN WE REALLY SHOULD CONSIDER
      THIS WOULD REPLACE THE TASK/CLUSTER FOR ACTUALLY RUNNING THE ELSA WEBSITE
      */

    new ElsaDataApplicationAppRunnerConstruct(this, "AppRunner", {
      vpc: vpc,
      container: container,
      hostedZoneCertificate: certificate!,
      hostedZone: hostedZone,
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

    /*const app = new ElsaDataApplicationFargateConstruct(this, "App", {
      cluster: cluster,
      container: container,
      taskDefinition: appDef,
      hostedZoneCertificate: certificate!,
      hostedZone: hostedZone,
      deployedUrl: deployedUrl,
      edgeDbSecurityGroup: edgeDbSecurityGroup,
      accessSecretsPolicyStatement:
        infraClient.getSecretPolicyStatementFromLookup(this),
      discoverServicesPolicyStatement:
        infraClient.getCloudMapDiscoveryPolicyStatementFromLookup(this),
      cloudMapNamespace: namespace,
      tempBucket: tempBucket,
      ...applicationProps,
    }); */

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

      const commandService = new FargateService(this, "CommandService", {
        cluster: cluster.cluster,
        taskDefinition: commandDef.taskDefinition,
        vpcSubnets: cluster.clusterSubnetSelection,
        securityGroups: [commandSecurityGroup, edgeDbSecurityGroup],
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
