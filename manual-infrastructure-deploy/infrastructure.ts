import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { InfrastructureStack } from "./infrastructure-stack";
import { InstanceClass, InstanceSize, InstanceType } from "aws-cdk-lib/aws-ec2";

const app = new cdk.App();

new InfrastructureStack(app, "ElsaDataLocalDevTestInfrastructureStack", {
  // the pipeline can only be deployed to 'dev'
  env: {
    account: "843407916570",
    region: "ap-southeast-2",
  },
  isDevelopment: true,
  network: {
    // use the dev VPC that we expect already exists
    vpcNameOrDefaultOrNull: "main-vpc",
  },
  dns: {
    hostedZoneName: "dev.umccr.org",
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

new InfrastructureStack(app, "ElsaDataAustralianGenomicsInfrastructureStack", {
  // the pipeline can only be deployed to 'ag'
  env: {
    account: "602836945884",
    region: "ap-southeast-2",
  },
  isDevelopment: false,
  network: {
    // we want it to construct a new custom VPC to limit breach surface
    vpcNameOrDefaultOrNull: null,
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
