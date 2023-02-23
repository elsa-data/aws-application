import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { TAG_STACK_VALUE } from "./elsa-data-constants";
import { ElsaDataStack } from "./deployment/elsa-data-stack";
import path from "path";

/**
 * Adds an *application* stack useful for deploying into dev/sandbox
 * environments. The intention is that this CDK stack is deployed
 * directly from a devs computer with changes that may
 * not yet be committed/PRed.
 *
 * This contrasts the pipeline stack which is a controlled
 * set of deployments based on commits.
 *
 * @param app
 */
export function addElsaDataLocalDevTest(app: cdk.App) {
  const devElsaImageFolder = path.join(
    __dirname,
    "../images",
    "elsa-data-application-docker-image"
  );

  new ElsaDataStack(app, "ElsaDataLocalDevTestStack", {
    // the pipeline can only be deployed to 'dev'
    env: {
      account: "843407916570",
      region: "ap-southeast-2",
    },
    tags: {
      Stack: TAG_STACK_VALUE,
    },
    serviceRegistration: {
      cloudMapNamespace: "umccr",
      cloudMapId: "ns-mjt63c4ppdrly4jd",
      cloudMapServiceName: "elsa-data",
    },
    network: {
      // use the dev VPC that we expect already exists
      vpcNameOrDefaultOrNull: "main-vpc",
    },
    dns: {
      hostedZoneCertificateArnSsm: "cert_apse2_arn",
      hostedZoneNameSsm: "/hosted_zone/umccr/name",
      hostedZoneIdSsm: "/hosted_zone/umccr/id",
    },
    serviceElsaData: {
      urlPrefix: "elsa",
      imageFolder: devElsaImageFolder,
      imageBaseName: "ghcr.io/umccr/elsa-data:latest",
      memoryLimitMiB: 2048,
      cpu: 1024,
    },
    serviceEdgeDb: {
      version: "2.9",
      memoryLimitMiB: 2048,
      cpu: 1024,
      dbUrlPrefix: "elsa-edge-db",
    },
  });
}
