import "source-map-support/register";
import { join } from "path";
import { ElsaDataStackSettings } from "../../workload-elsa-data-aws/elsa-data-stack-settings";
import { StackProps } from "aws-cdk-lib";

/**
 * The settings for our deployment to Australian Genomics demo.
 */
export function getDeploymentAgDemoProps(): StackProps & ElsaDataStackSettings {
  return {
    env: {
      account: "602836945884",
      region: "ap-southeast-2",
    },
    serviceRegistration: {
      cloudMapServiceName: "elsa-data-demo",
    },
    infrastructureStackName: "InfrastructureStack",
    serviceElsaData: {
      urlPrefix: "elsa-demo",
      imageFolder: join(
        __dirname,
        "..",
        "images",
        "elsa-data-application-deployment-ag-demo-docker-image"
      ),
      imageBaseName: "ghcr.io/umccr/elsa-data:0.1",
      memoryLimitMiB: 2048,
      cpu: 1024,
      awsPermissions: {
        dataBucketPaths: {
          "agha-gdr-storedemo-1.0": ["Somatic/*"],
          "agha-gdr-store-2.0": ["Cardiac/*/manifest.txt"],
        },
        enableAccessPoints: false,
      },
      metaConfigSources:
        "file('base') file('dev-common') file('dev-deployed') file('datasets') aws-secret('ElsaDataDevDeployed')",
      metaConfigFolders: "./config:./extra-config",
    },
    serviceEdgeDb: {
      version: "2.12",
      memoryLimitMiB: 2048,
      cpu: 1024,
    },
  };
}
