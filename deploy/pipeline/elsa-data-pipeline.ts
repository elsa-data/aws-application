import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ElsaDataPipelineStack } from "./elsa-data-pipeline-stack";
import { TAG_STACK_VALUE } from "./elsa-data-constants";
import { TAG_PRODUCT_KEY, TAG_PRODUCT_VALUE } from "../constants";

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
