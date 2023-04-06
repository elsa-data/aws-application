import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { InfrastructureStack } from "./infrastructure-stack";
import { InstanceClass, InstanceSize, InstanceType } from "aws-cdk-lib/aws-ec2";
import { TAG_PRODUCT_KEY, TAG_PRODUCT_VALUE } from "../constants";

const app = new cdk.App();

const tags = {
  Stack: "ElsaDataInfrastructure",
  [TAG_PRODUCT_KEY]: TAG_PRODUCT_VALUE,
};

const ns = "elsa-data";

const description =
  "Infrastructure for Elsa Data - an application for controlled genomic data sharing";

new InfrastructureStack(app, "ElsaDataLocalDevTestInfrastructureStack", {
  // the pipeline can only be deployed to 'dev'
  env: {
    account: "843407916570",
    region: "ap-southeast-2",
  },
  tags: tags,
  isDevelopment: true,
  description: description,
  network: {
    // use the dev VPC that we expect already exists
    vpcNameOrDefaultOrNull: "main-vpc",
  },
  namespace: {
    name: ns,
  },
  dns: {
    hostedZoneName: "dev.umccr.org",
  },
  database: {
    instanceType: InstanceType.of(
      InstanceClass.BURSTABLE4_GRAVITON,
      InstanceSize.MICRO
    ),
    dbAdminUser: `elsa_admin`,
    dbName: `elsa_database`,
  },
  secretsPrefix: "ElsaData", // pragma: allowlist secret
});

new InfrastructureStack(app, "ElsaDataAustralianGenomicsInfrastructureStack", {
  // the pipeline can only be deployed to 'ag'
  env: {
    account: "602836945884",
    region: "ap-southeast-2",
  },
  tags: tags,
  isDevelopment: false,
  description: description,
  network: {
    // we want it to construct a new custom VPC to limit breach surface
    vpcNameOrDefaultOrNull: null,
  },
  namespace: {
    name: ns,
  },
  dns: {
    hostedZoneName: "agha.umccr.org",
  },
  database: {
    instanceType: InstanceType.of(
      InstanceClass.BURSTABLE4_GRAVITON,
      InstanceSize.SMALL
    ),
    dbAdminUser: `elsa_admin`,
    dbName: `elsa_database`,
  },
  secretsPrefix: "ElsaData", // pragma: allowlist secret
});
