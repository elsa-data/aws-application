import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { join } from "path";
import { ElsaDataStack } from "@umccr/elsa-data-aws-application";
import { Aspects } from "aws-cdk-lib";
import {
  AwsSolutionsChecks,
  HIPAASecurityChecks,
  NIST80053R5Checks,
} from "cdk-nag";

const app = new cdk.App();

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
Aspects.of(app).add(new HIPAASecurityChecks({ verbose: true }));
Aspects.of(app).add(new NIST80053R5Checks({ verbose: true }));

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
const LOCAL_DEV_TEST_DEPLOYED_IMAGE_TAG = "pr-421";

// should be a 'released' image tag that has already been tested in dev
// const AG_DEMO_DEPLOYED_IMAGE = "ghcr.io/umccr/elsa-data:0.1.7";
// const AG_DEMO_DEPLOYED_IMAGE = "ghcr.io/umccr/elsa-data:pr-363";
// or can be a very specific SHA256 (NOTE needs the @ not colon)
const AG_DEMO_DEPLOYED_IMAGE =
  "ghcr.io/umccr/elsa-data@sha256:0707e0c667d809459324312b7280e7a7f1f1864c43591128596aebd5b6ee7adb";

const AG_DEMO_BUCKET_NAME = "elsa-data-demo-agha-gdr-store";

/**
 * Stack for dev
 */
new ElsaDataStack(
  app,
  "ElsaDataDevStack",
  {
    env: {
      account: "843407916570",
      region: "ap-southeast-2",
    },
    description: descriptionWithTag(undefined),
    tags: {
      "umccr-org:ProductVersion": LOCAL_DEV_TEST_DEPLOYED_IMAGE_TAG,
      ...tags,
    },
  },
  {
    infrastructureStackName: "ElsaDataDevInfrastructureStack",
    infrastructureDatabaseName: "elsa_data_serverless_database",
    urlPrefix: "elsa-data",
    imageBaseName: `ghcr.io/umccr/elsa-data:${LOCAL_DEV_TEST_DEPLOYED_IMAGE_TAG}`,
    buildLocal: {
      folder: join(
        __dirname,
        "..",
        "..",
        "artifacts",
        "elsa-data-application-local-dev-test-docker-image"
      ),
    },
    metaConfigSources:
      "file('base') file('admins') file('datasets') file('dacs') aws-secret('ElsaDataDevDeployed')",
    metaConfigFolders: "/dev-config",
    awsPermissions: {
      dataBucketPaths: {
        "umccr-10f-data-dev": ["ASHKENAZIM/*"],
        "umccr-10g-data-dev": ["*"],
        "umccr-10c-data-dev": ["*"],
      },
      enableAccessPoints: true,
    },
  }
);
