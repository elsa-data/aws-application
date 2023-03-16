import "source-map-support/register";
import { TAG_STACK_VALUE } from "./elsa-data-constants";
import { StackProps } from "aws-cdk-lib";
import { ElsaDataStackSettings } from "./deployment-application/elsa-data-stack-settings";

/**
 * The settings for our deployment to local-dev-test.
 *
 * Local dev/test is a deployment that can be brought up and down by anyone
 * in dev. It is meant to encapsulate CDK work during the process of development i.e
 * before it becomes a PR.
 */
export function getDeploymentLocalDevTestProps(): StackProps &
  ElsaDataStackSettings {
  return {
    // the pipeline can only be deployed to 'dev'
    env: {
      account: "843407916570",
      region: "ap-southeast-2",
    },
    tags: {
      Stack: TAG_STACK_VALUE,
    },
    isDevelopment: true,
    serviceRegistration: {
      cloudMapNamespace: "umccr",
      cloudMapId: "ns-mjt63c4ppdrly4jd",
      cloudMapServiceName: "elsa-data",
    },
    infrastructureStack: "ElsaDataLocalDevTestInfrastructureStack",
    infrastructureVpcId: "vpc-00eafc63c0dfca266",
    serviceElsaData: {
      urlPrefix: "elsa",
      imageBaseName: "ghcr.io/umccr/elsa-data:dev",
      metaConfigSources:
        "file('base') file('dev-common') file('dev-deployed') file('datasets') aws-secret('ElsaDataDevDeployed')",
      awsPermissions: {
        dataBucketPaths: {
          "umccr-10f-data-dev": ["ASHKENAZIM/*"],
          "umccr-10g-data-dev": ["*"],
          "umccr-10c-data-dev": ["*"],
        },
        enableAccessPoints: true,
      },
      memoryLimitMiB: 2048,
      cpu: 1024,
    },
    serviceEdgeDb: {
      version: "2.12",
      memoryLimitMiB: 2048,
      cpu: 1024,
      // the URL prefix of the database UI (which is exposed due to isDevelopment=true)
      dbUrlPrefix: "elsa-edge-db",
      dbUrlPort: 4000,
      dbUiUrlPort: 4001,
    },
  };
}
