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
const DEV_DEPLOYED_IMAGE_TAG = "pr-563";

// waf rules need a priority that we want to base on the order they occur in our
// declarations - we use this counter for that
let rulePriorityCounter = 0;

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
      ProductVersion: DEV_DEPLOYED_IMAGE_TAG,
      Stack: "ElsaDataApplication",
      Product: "ElsaData",
    },
  },
  {
    infrastructureStackName: "ElsaDataDevInfrastructureStack",
    isDevelopment: true,
    urlPrefix: "elsa-data",
    // this image gets inserted as the _base_ of the new image being built via buildLocal
    // so buildLocal gives us a chance to specialise this base image
    imageBaseName: `ghcr.io/elsa-data/elsa-data:${DEV_DEPLOYED_IMAGE_TAG}`,
    buildLocal: {
      folder: join(__dirname, "dev-docker-image"),
    },
    metaConfigSources:
      "file('base') file('admins') file('datasets') file('sharers') file('consenters') file('dacs') aws-secret('ElsaDataDevDeployed')",
    metaConfigFolders: "/dev-config",
    awsPermissions: {
      dataBucketPaths: {
        "umccr-10f-data-dev": ["ASHKENAZIM/*"],
        "umccr-10g-data-dev": ["*"],
        "umccr-10c-data-dev": ["*"],
      },
      enableAccessPoints: true,
    },
    databaseName: "dev",
    databaseSource: {
      cloudDatabaseInstanceName: "umccr/elsa-data",
      cloudDatabaseSecretName: "ElsaDataDevGelCloudSecret", // pragma: allowlist secret
    },
    wafRules: [
      {
        name: "LimitRequests100",
        priority: rulePriorityCounter++,
        action: {
          block: {},
        },
        statement: {
          rateBasedStatement: {
            // given our site is not one where you'd expect high traffic - we set this to
            // the minimum, and we will see how that plays out
            limit: 100,
            aggregateKeyType: "IP",
          },
        },
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: "LimitRequests100",
        },
      },
      {
        name: "AllowedCountriesOnly",
        priority: rulePriorityCounter++,
        action: {
          block: {},
        },
        statement: {
          notStatement: {
            statement: {
              geoMatchStatement: {
                // block traffic if not from below
                countryCodes: ["AU"],
              },
            },
          },
        },
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: "AllowedCountriesOnly",
        },
      },
      {
        name: "AWS-AWSManagedRulesCommonRuleSet",
        priority: rulePriorityCounter++,
        statement: {
          managedRuleGroupStatement: {
            name: "AWSManagedRulesCommonRuleSet",
            vendorName: "AWS",
            // an example of how we might want to exclude rules
            // excludedRules: [
            //  {
            //    name: "SizeRestrictions_BODY",
            //  },
            //],
          },
        },
        overrideAction: {
          none: {},
        },
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: "AWS-AWSManagedRulesCommonRuleSet",
        },
      },
      {
        name: "AWS-AWSManagedRulesAmazonIpReputationList",
        priority: rulePriorityCounter++,
        statement: {
          managedRuleGroupStatement: {
            vendorName: "AWS",
            name: "AWSManagedRulesAmazonIpReputationList",
          },
        },
        overrideAction: {
          none: {},
        },
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: "AWS-AWSManagedRulesAmazonIpReputationList",
        },
      },
    ],
  }
);
