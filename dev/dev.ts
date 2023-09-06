import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { join } from "path";
import { ElsaDataStack } from "@elsa-data/aws-application";
import { Aspects } from "aws-cdk-lib";
import {
  AwsSolutionsChecks,
  HIPAASecurityChecks,
  NIST80053R5Checks,
} from "cdk-nag";

const app = new cdk.App();

// Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
// Aspects.of(app).add(new HIPAASecurityChecks({ verbose: true }));
// Aspects.of(app).add(new NIST80053R5Checks({ verbose: true }));

const descriptionWithTag = (tag?: string) =>
  `Application for Elsa Data ${
    tag ? "(" + tag + ") " : ""
  }- an application for controlled genomic data sharing`;

// bring this out to the top as it is the type of thing we might want to change during dev
// to point to other PR branches etc
const DEV_DEPLOYED_IMAGE_TAG = "0.4.1";

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
      "umccr-org:ProductVersion": DEV_DEPLOYED_IMAGE_TAG,
      "umccr-org:Stack": "ElsaDataApplication",
      "umccr-org:Product": "ElsaData",
    },
  },
  {
    infrastructureStackName: "ElsaDataDevInfrastructureStack",
    infrastructureDatabaseInstanceName: "elsa_data_serverless_database",
    isDevelopment: true,
    urlPrefix: "elsa-data",
    // this image gets inserted as the base of the new image being built via buildLocal
    imageBaseName: `ghcr.io/elsa-data/elsa-data:${DEV_DEPLOYED_IMAGE_TAG}`,
    buildLocal: {
      folder: join(__dirname, "dev-docker-image"),
    },
    metaConfigSources:
      "file('base') file('admins') file('datasets') file('sharers') file('dacs') aws-secret('ElsaDataDevDeployed')",
    metaConfigFolders: "/dev-config",
    awsPermissions: {
      dataBucketPaths: {
        "umccr-10f-data-dev": ["ASHKENAZIM/*"],
        "umccr-10g-data-dev": ["*"],
        "umccr-10c-data-dev": ["*"],
      },
      enableAccessPoints: true,
    },
    databaseName: "elsa_data",
  }
);
