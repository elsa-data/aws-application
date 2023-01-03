import { pipelines, Stack, StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { ElsaDataBuildStage } from "./elsa-data-build-stage";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { readFileSync } from "fs";
import { STACK_DESCRIPTION, TAG_STACK_VALUE } from "./elsa-data-constants";
import {
  BuildSpec,
  LinuxArmBuildImage,
  LinuxBuildImage,
} from "aws-cdk-lib/aws-codebuild";

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
      dockerEnabledForSelfMutation: true,
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
          "pnpm install",
          // our cdk is configured to use ts-node - so we don't need any typescript build step - just synth
          "pnpm exec cdk synth",
        ],
        primaryOutputDirectory: "ci/cdk.out",
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
      crossAccountKeys: true,
    });

    const hostedPrefix = "elsa";

    const devStage = new ElsaDataBuildStage(this, "Dev", {
      env: {
        account: "843407916570",
        region: "ap-southeast-2",
      },
      cloudMapNamespace: "umccr",
      cloudMapId: "ns-mjt63c4ppdrly4jd",
      cloudMapServiceName: "elsa-data",
      hostedPrefix: hostedPrefix,
      memoryLimitMiB: 2048,
      cpu: 1024,
    });

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

    /*
    pipeline.addStage(devStage, {
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

    /*pipeline.addStage(prodStage, {
      pre: [new pipelines.ManualApprovalStep("PromoteToProd")],
    }); */
  }
}
