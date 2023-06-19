import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ElsaDataStack } from "../../workload-elsa-data-aws/elsa-data-stack";
import { join } from "path";

const app = new cdk.App();

// tags for our stacks
const tags = {
  "umccr-org:Stack": "ElsaDataApplication",
  "umccr-org:Product": "ElsaData",
};

const descriptionWithTag = (tag: string) =>
  `Application for Elsa Data (${tag}) - an application for controlled genomic data sharing`;

// bring this out to the top as it is the type of thing we might want to change during dev
// to point to other PR branches etc - try not the check this in with anything other than
// dev though
const LOCAL_DEV_TEST_DEPLOYED_IMAGE_TAG = "dev";

// should be a 'released' image tag that has already been tested in dev
const AG_DEMO_DEPLOYED_IMAGE_TAG = "0.1.7";

/**
 * Stack for local dev/test
 */
new ElsaDataStack(app, "ElsaDataLocalDevTestStack", {
  env: {
    account: "843407916570",
    region: "ap-southeast-2",
  },
  description: descriptionWithTag(LOCAL_DEV_TEST_DEPLOYED_IMAGE_TAG),
  tags: tags,
  infrastructureStackName: "ElsaDataLocalDevTestInfrastructureStack",
  infrastructureDatabaseName: "elsa_data_serverless_database",
  urlPrefix: "elsa-data",
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
});

/**
 * Stack for australian genomics demonstration
 */
new ElsaDataStack(app, "ElsaDataDemoAustralianGenomicsStack", {
  env: {
    account: "602836945884",
    region: "ap-southeast-2",
  },
  description: descriptionWithTag(AG_DEMO_DEPLOYED_IMAGE_TAG),
  tags: tags,
  infrastructureStackName: "ElsaDataDemoAustralianGenomicsInfrastructureStack",
  infrastructureDatabaseName: "elsa_data_serverless_database",
  urlPrefix: "elsa-data-demo",
  imageBaseName: `ghcr.io/umccr/elsa-data:${AG_DEMO_DEPLOYED_IMAGE_TAG}`,
  buildLocal: {
    folder: join(
      __dirname,
      "..",
      "..",
      "artifacts",
      "elsa-data-application-deployment-ag-demo-docker-image"
    ),
  },
  awsPermissions: {
    dataBucketPaths: {
      // we are testing out how well here we can reduce the footprint to *just* manifests
      // (object signing permissions are elsewhere)
      "elsa-test-data": ["FLAGSHIP_A/*/manifest.txt"],
      // synthetic datasets just for demo
      "agha-demo-gdr-store": ["*"],
    },
    enableAccessPoints: true,
  },
  metaConfigSources:
    "file('base') file('admins') file('datasets') file('dacs') aws-secret('ElsaDataDemoConfiguration')",
  metaConfigFolders: "/ag-config",
  // this demo instance we like to be able to rotate through various databases (and easily make new ones)
  // - create new databases in the EdgeDb UI
  // - then do a CDK update with the new name here
  // - then do a db-migrate
  databaseName: "elsadata2",
});
