import { pipelines, Stack, StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { ElsaDataBuildStage } from "./elsa-data-build-stage";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { STACK_DESCRIPTION, TAG_STACK_VALUE } from "./elsa-data-constants";
import { BuildSpec, LinuxBuildImage } from "aws-cdk-lib/aws-codebuild";
import { getDeploymentAgDemoProps } from "./elsa-data-deployment-ag-demo-props";

/**
 * Stack to hold the self mutating pipeline, and all the relevant settings for deployments
 */
export class ElsaDataPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.tags.setTag("Stack", TAG_STACK_VALUE);
    this.templateOptions.description = STACK_DESCRIPTION;

    // these are *build* parameters that we either want to re-use across lots of stacks, or are
    // 'sensitive' enough we don't want them checked into Git - but not sensitive enough to record as a Secret
    // NOTE: these are looked up at the *build pipeline deploy* stage
    const codeStarArn = StringParameter.valueFromLookup(
      this,
      "codestar_github_arn"
    );

    const pipeline = new pipelines.CodePipeline(this, "Pipeline", {
      // turned on because our stack makes docker assets
      dockerEnabledForSynth: true,
      crossAccountKeys: true,
      codeBuildDefaults: {
        buildEnvironment: {
          buildImage: LinuxBuildImage.STANDARD_6_0,
        },
        partialBuildSpec: BuildSpec.fromObject({
          phases: {
            install: {
              commands: [
                "n 18",
                "corepack enable",
                "corepack prepare pnpm@latest --activate",
              ],
            },
          },
        }),
      },
      synth: new pipelines.CodeBuildStep("Synth", {
        // Use a connection created using the AWS console to authenticate to GitHub
        // Other sources are available.
        input: pipelines.CodePipelineSource.connection(
          "umccr/elsa-data-aws-deploy",
          "main",
          {
            connectionArn: codeStarArn,
          }
        ),
        commands: [
          "cd ci",
          "npm ci",
          // our cdk is configured to use ts-node - so we don't need any typescript build step - just synth
          "npx cdk synth -v",
        ],
        primaryOutputDirectory: "ci/cdk.out",
        // a blank env needs to be left here in order for the assumerole/cross account permissions in CDK to work
        env: {},
        rolePolicyStatements: [
          new PolicyStatement({
            actions: ["sts:AssumeRole"],
            resources: ["*"],
            conditions: {
              StringEquals: {
                "iam:ResourceTag/aws-cdk:bootstrap-role": "lookup",
              },
            },
          }),
        ],
      }),
    });

    const agDemoStage = new ElsaDataBuildStage(
      this,
      "AgDemo",
      getDeploymentAgDemoProps()
    );

    pipeline.addStage(agDemoStage);

    /*const prodStage = new ElsaDataBuildStage(this, "Prod", {
      env: {
        account: "472057503814",
        region: "ap-southeast-2",
      },
      cloudMapNamespace: cloudMapNamespace,
      cloudMapId: cloudMapId,
      cloudMapServiceName: cloudMapServiceName,
      hostedPrefix: hostedPrefix,
      parameterNameOidcClientId: parameterNameOidcClientId,
      parameterNameOidcClientSecret: parameterNameOidcClientSecret,
      parameterNameOidcClientMetadataUrl: parameterNameOidcClientMetadataUrl,
      smtpMailFrom: smtpMailFrom,
      memoryLimitMiB: 2048,
      cpu: 1024,
    }); */

    /*pipeline.addStage(prodStage, {
      pre: [new pipelines.ManualApprovalStep("PromoteToProd")],
      post: [
        new pipelines.ShellStep("Validate Endpoint", {
          envFromCfnOutputs: {
            // DEPLOYED_URL: devStage.deployUrlOutput,
          },
          commands: [
            // "echo $DEPLOYED_URL",
            // "cd test",
            // "npm ci",
            // `npm run test -- "$DEPLOYED_URL"`,
          ],
        }),
      ],
    }); */
  }
}
