import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ElsaDataStack } from "../../workload-elsa-data-aws/elsa-data-stack";
import { ElsaDataExampleBucketStack } from "../../workload-elsa-data-example-bucket/elsa-data-example-bucket-stack";
import { join } from "path";

const app = new cdk.App();

// tags for our stacks
const tags = {
  "umccr-org:Stack": "ElsaDataApplication",
  "umccr-org:Product": "ElsaData",
};

const descriptionWithTag = (tag?: string) =>
  `Application for Elsa Data ${
    tag ? "(" + tag + ") " : ""
  }- an application for controlled genomic data sharing`;

// bring this out to the top as it is the type of thing we might want to change during dev
// to point to other PR branches etc - try not the check this in with anything other than
// dev though
const LOCAL_DEV_TEST_DEPLOYED_IMAGE_TAG = "dev";

// should be a 'released' image tag that has already been tested in dev
// const AG_DEMO_DEPLOYED_IMAGE = "ghcr.io/umccr/elsa-data:0.1.7";
// const AG_DEMO_DEPLOYED_IMAGE = "ghcr.io/umccr/elsa-data:pr-363";
// or can be a very specific SHA256 (NOTE needs the @ not colon)
const AG_DEMO_DEPLOYED_IMAGE =
  "ghcr.io/umccr/elsa-data@sha256:0707e0c667d809459324312b7280e7a7f1f1864c43591128596aebd5b6ee7adb";

const AG_DEMO_BUCKET_NAME = "elsa-data-demo-agha-gdr-store";

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
  description: descriptionWithTag(undefined),
  tags: tags,
  infrastructureStackName: "ElsaDataDemoAustralianGenomicsInfrastructureStack",
  infrastructureDatabaseName: "elsa_data_serverless_database",
  urlPrefix: "elsa-data-demo",
  imageBaseName: AG_DEMO_DEPLOYED_IMAGE,
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
      [AG_DEMO_BUCKET_NAME]: [
        "Blackjack/*/manifest.txt",
        "Blackjack/*/*.phenopacket.json",
        "Smartie/*/manifest.txt",
        "Smartie/*/*.phenopacket.json",
      ],
    },
    enableAccessPoints: false,
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

new ElsaDataExampleBucketStack(
  app,
  "ElsaDataDemoAustralianGenomicsExampleBucketStack",
  {
    env: {
      account: "602836945884",
      region: "ap-southeast-2",
    },
    tags: {
      "umccr-org:Stack": "ElsaDataExampleBucket",
      "umccr-org:Product": "ElsaData",
    },
    description: `Example bucket for Elsa Data - an application for controlled genomic data sharing`,
    bucketName: AG_DEMO_BUCKET_NAME,
  }
);
