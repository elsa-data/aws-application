import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ElsaDataStack } from "../../workload-elsa-data-aws/elsa-data-stack";
import { join } from "path";

const app = new cdk.App();

// bring this out to the top as it is the type of thing we might want to change during dev
// to point to other PR branches etc - try not the check this in with anything other than
// dev though
const LOCAL_DEV_TEST_DEPLOYED_IMAGE_TAG = "dev";

// should be altered only when we are prepared for the demo instance to be updated
const AG_DEMO_DEPLOYED_IMAGE_TAG = "dev";

new ElsaDataStack(app, "ElsaDataLocalDevTestStack", {
  env: {
    account: "843407916570",
    region: "ap-southeast-2",
  },
  tags: {
    "umccr-org:Product": "ElsaData",
  },
  isDevelopment: true,
  infrastructureStackName: "ElsaDataLocalDevTestInfrastructureStack",
  serviceRegistration: {
    cloudMapServiceName: "Application",
  },
  serviceElsaData: {
    urlPrefix: "elsa",
    imageBaseName: `ghcr.io/umccr/elsa-data:${LOCAL_DEV_TEST_DEPLOYED_IMAGE_TAG}`,
    metaConfigSources:
      "file('base') file('umccr-garvan-dev-super-admins') file('dev-deployed') file('datasets') aws-secret('ElsaDataDevDeployed')",
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
    version: "2.13",
    memoryLimitMiB: 2048,
    cpu: 512,
    // the URL prefix of the database UI (which is exposed due to isDevelopment=true)
    dbUrlPrefix: "elsa-edge-db",
    dbUrlPort: 4000,
    dbUiUrlPort: 4001,
  },
});

new ElsaDataStack(app, "ElsaDataDemoAustralianGenomicsStack", {
  env: {
    account: "602836945884",
    region: "ap-southeast-2",
  },
  tags: {
    "umccr-org:Product": "ElsaData",
  },
  serviceRegistration: {
    cloudMapServiceName: "Application",
  },
  isDevelopment: false,
  infrastructureStackName: "ElsaDataDemoAustralianGenomicsInfrastructureStack",
  serviceElsaData: {
    urlPrefix: "elsa-demo",
    imageFolder: join(
      __dirname,
      "..",
      "images",
      "elsa-data-application-deployment-ag-demo-docker-image"
    ),
    imageBaseName: `ghcr.io/umccr/elsa-data:${AG_DEMO_DEPLOYED_IMAGE_TAG}`,
    memoryLimitMiB: 1024,
    cpu: 512,
    awsPermissions: {
      dataBucketPaths: {
        // we are testing out how well here we can reduce the footprint to *just* manifests
        // (object signing permissions are elsewhere)
        "elsa-test-data": ["FLAGSHIP_A/*/manifest.txt"],
      },
      enableAccessPoints: true,
    },
    metaConfigSources:
      "file('base') file('admins') file('datasets') aws-secret('ElsaDataDemo')",
    metaConfigFolders: "/ag-config",
  },
  serviceEdgeDb: {
    version: "2.13",
    memoryLimitMiB: 2048,
    cpu: 512,
  },
});
