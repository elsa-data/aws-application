import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ElsaDataStack } from "../../workload-elsa-data-aws/elsa-data-stack";

const app = new cdk.App();

// bring this out to the top as it is the type of thing we might want to change during dev
// to point to other PR branches etc - try not the check this in with anything other than
// dev though
const DEPLOYED_IMAGE_TAG = "dev";

new ElsaDataStack(app, "ElsaDataLocalDevTestStack", {
  env: {
    account: "843407916570",
    region: "ap-southeast-2",
  },
  tags: {
    "umccr-org:Product": "ElsaData",
  },
  isDevelopment: true,
  forceDeployment: true,
  infrastructureStackName: "ElsaDataLocalDevTestInfrastructureStack",
  serviceRegistration: {
    cloudMapServiceName: "Application",
  },
  serviceElsaData: {
    urlPrefix: "elsa",
    imageBaseName: `ghcr.io/umccr/elsa-data:${DEPLOYED_IMAGE_TAG}`,
    buildLocal: {
      folder: "../../artifacts/elsa-data-application-local-dev-test-docker-image"
    },
    metaConfigSources:
      "file('base') file('umccr-garvan-dev-super-admins') file('dev-deployed') file('datasets') aws-secret('ElsaDataDevDeployed') file('deploy-database-instance')",
    awsPermissions: {
      dataBucketPaths: {
        "umccr-10f-data-dev": ["ASHKENAZIM/*"],
        "umccr-10g-data-dev": ["*"],
        "umccr-10c-data-dev": ["*"],
      },
      enableAccessPoints: true,
    },
    memoryLimitMiB: 1024,
    cpu: 512,
  },
  serviceEdgeDb: {
    version: "3.0-beta.1",
    memoryLimitMiB: 2048,
    cpu: 1024,
    // the URL prefix of the database UI (which is exposed due to isDevelopment=true)
    dbUrlPrefix: "elsa-edge-db",
    secretPrefix: "ElsaData",
    dbUrlPort: 4000,
    dbUiUrlPort: 4001,
  },
});

new ElsaDataStack(app, "ElsaDataServerlessLocalDevTestStack", {
  env: {
    account: "843407916570",
    region: "ap-southeast-2",
  },
  tags: {
    "umccr-org:Product": "ElsaData",
  },
  isDevelopment: true,
  forceDeployment: true,
  infrastructureStackName: "ElsaDataServerlessLocalDevTestInfrastructureStack",
  serviceRegistration: {
    cloudMapServiceName: "Application",
  },
  serviceElsaData: {
    urlPrefix: "elsa-serverless",
    imageBaseName: `ghcr.io/umccr/elsa-data:${DEPLOYED_IMAGE_TAG}`,
    buildLocal: {
      folder: "../../artifacts/elsa-data-application-local-dev-test-docker-image"
    },
    metaConfigSources:
      "file('base') file('umccr-garvan-dev-super-admins') file('dev-deployed') file('datasets') aws-secret('ElsaDataDevDeployed') file('deploy-database-serverless')",
    awsPermissions: {
      dataBucketPaths: {
        "umccr-10f-data-dev": ["ASHKENAZIM/*"],
        "umccr-10g-data-dev": ["*"],
        "umccr-10c-data-dev": ["*"],
      },
      enableAccessPoints: true,
    },
    memoryLimitMiB: 1024,
    cpu: 512,
  },
  serviceEdgeDb: {
    version: "3.0-beta.1",
    memoryLimitMiB: 2048,
    cpu: 1024,
    // the URL prefix of the database UI (which is exposed due to isDevelopment=true)
    dbUrlPrefix: "elsa-edge-db-serverless",
    secretPrefix: "ElsaDataServerless",
    dbUrlPort: 4000,
    dbUiUrlPort: 4001,
  },
});
