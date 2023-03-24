import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ElsaDataPipelineStack } from "./elsa-data-pipeline-stack";
import { TAG_STACK_VALUE } from "./elsa-data-constants";
import { getDeploymentLocalDevTestProps } from "./elsa-data-deployment-local-dev-test-props";
import { ElsaDataStack } from "./deployment-application/elsa-data-stack";
import { CopyOutStack } from "./deployment-copy-out/copy-out-stack";
import { TAG_PRODUCT_KEY, TAG_PRODUCT_VALUE } from "../constants";
import { SubnetType } from "aws-cdk-lib/aws-ec2";

const AWS_BUILD_ACCOUNT = "383856791668";
const AWS_BUILD_REGION = "ap-southeast-2";

const app = new cdk.App();

// NOTE: this is the CI pipeline stack - that itself will publish/build ElsaDataStack
new ElsaDataPipelineStack(app, "ElsaDataPipelineStack", {
  // the pipeline can only be deployed to 'build' and this should only happen once
  // after which the pipeline will be self-updating/deploying
  env: {
    account: AWS_BUILD_ACCOUNT,
    region: AWS_BUILD_REGION,
  },
  tags: {
    Stack: TAG_STACK_VALUE,
    [TAG_PRODUCT_KEY]: TAG_PRODUCT_VALUE,
  },
});

// NOTE: this is a direct deployment of ElsaDataStack to dev
new ElsaDataStack(
  app,
  "ElsaDataLocalDevTestStack",
  getDeploymentLocalDevTestProps()
);

new CopyOutStack(app, "ElsaDataLocalDevTestCopyOutStack", {
  // the pipeline can only be deployed to 'dev'
  env: {
    account: "843407916570",
    region: "ap-southeast-2",
  },
  tags: {
    Stack: TAG_STACK_VALUE + "CopyOut",
    [TAG_PRODUCT_KEY]: TAG_PRODUCT_VALUE,
  },
  isDevelopment: true,
  infrastructureStack: "ElsaDataLocalDevTestInfrastructureStack",
  infrastructureSubnetSelection: SubnetType.PRIVATE_WITH_EGRESS,
});

new CopyOutStack(app, "ElsaDataAgCopyOutStack", {
  // the pipeline can only be deployed to 'dev'
  env: {
    account: "843407916570",
    region: "ap-southeast-2",
  },
  tags: {
    Stack: TAG_STACK_VALUE + "CopyOut",
    [TAG_PRODUCT_KEY]: TAG_PRODUCT_VALUE,
  },
  isDevelopment: true,
  infrastructureStack: "ElsaDataLocalDevTestInfrastructureStack",
  infrastructureSubnetSelection: SubnetType.PRIVATE_ISOLATED,
});
