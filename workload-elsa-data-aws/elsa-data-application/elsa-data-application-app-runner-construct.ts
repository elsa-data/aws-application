import {
  aws_ec2 as ec2,
  aws_ecs as ecs,
  CfnOutput,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import {
  Policy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { ISecret } from "aws-cdk-lib/aws-secretsmanager";
import { Service } from "aws-cdk-lib/aws-servicediscovery";
import { IHostedZone } from "aws-cdk-lib/aws-route53";
import { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { ElsaDataApplicationStackSettings } from "./elsa-data-application-stack-settings";
import * as apprunner from "@aws-cdk/aws-apprunner-alpha";

interface Props extends StackProps {
  vpc: ec2.IVpc;

  hostedZone: IHostedZone;
  hostedZoneCertificate: ICertificate;

  cloudMapService: Service;

  /**
   * The (passwordless) DSN of our EdgeDb instance as passed to us
   * from the EdgeDb stack.
   */
  edgeDbDsnNoPassword: string;

  /**
   * The secret holding the password of our EdgeDb instance.
   */
  edgeDbPasswordSecret: ISecret;

  settings: ElsaDataApplicationStackSettings;
}

/**
 * The stack for deploying the actual Elsa Data web application via AppRunner.
 */
export class ElsaDataApplicationAppRunnerConstruct extends Construct {
  public deployedUrl: string;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    this.deployedUrl = `https://${props.settings.urlPrefix}.${props.hostedZone.zoneName}`;

    if (!props.settings.buildLocal) return;

    const asset = new DockerImageAsset(this, "DockerImageAsset", {
      directory: props.settings.buildLocal.folder,
      platform: Platform.LINUX_AMD64,
      buildArgs: {
        ELSA_DATA_BASE_IMAGE: props.settings.imageBaseName,
      },
    });

    const vpcConnector = new apprunner.VpcConnector(this, "VpcConnector", {
      vpc: props.vpc,
      vpcSubnets: props.vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      }),
    });

    const policy = this.createPolicy(
      props.settings.awsPermissions.dataBucketPaths,
      props.settings.awsPermissions.enableAccessPoints
    );

    const role = new Role(this, "ServiceRole", {
      assumedBy: new ServicePrincipal("tasks.apprunner.amazonaws.com"),
    });

    role.attachInlinePolicy(policy);

    const appService = new apprunner.Service(this, "Service", {
      source: apprunner.Source.fromAsset({
        imageConfiguration: {
          port: 80,
          environmentSecrets: {
            EDGEDB_PASSWORD: ecs.Secret.fromSecretsManager(
              props.edgeDbPasswordSecret
            ),
          },
          environmentVariables: {
            EDGEDB_DSN: props.edgeDbDsnNoPassword,
            EDGEDB_CLIENT_TLS_SECURITY: "insecure",
            ELSA_DATA_META_CONFIG_FOLDERS:
              props.settings.metaConfigFolders || "./config",
            ELSA_DATA_META_CONFIG_SOURCES: props.settings.metaConfigSources,
            // override any config settings that we know definitively here because of the
            // way we have done the deployment
            ELSA_DATA_CONFIG_DEPLOYED_URL: this.deployedUrl,
            ELSA_DATA_CONFIG_PORT: "80",
            ELSA_DATA_CONFIG_AWS_TEMP_BUCKET: "tempbucket",
          },
        },
        asset: asset,
      }),
      instanceRole: role,
      autoDeploymentsEnabled: false,
      vpcConnector: vpcConnector,
    });

    new CfnOutput(this, "ElsaDataDeployUrl", {
      value: appService.serviceUrl,
    });
  }

  /**
   * A policy statement that we can use that gives access only to
   * known Elsa Data secrets (by naming convention).
   *
   * @private
   */
  private getSecretPolicyStatement(): PolicyStatement {
    return new PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [
        `arn:aws:secretsmanager:${Stack.of(this).region}:${
          Stack.of(this).account
        }:secret:ElsaData*`,
      ],
    });
  }

  private createPolicy(
    dataBucketPaths: { [p: string]: string[] },
    enableAccessPoints: boolean
  ): Policy {
    const policy = new Policy(this, "FargateServiceTaskPolicy");

    // need to be able to fetch secrets - we wildcard to every Secret that has our designated prefix of elsa*
    policy.addStatements(this.getSecretPolicyStatement());

    // for some of our scaling out work (Beacon etc) - we are going to make Lambdas that we want to be able to invoke
    // again we wildcard to a designated prefix of elsa-data*
    policy.addStatements(
      new PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [
          `arn:aws:lambda:${Stack.of(this).region}:${
            Stack.of(this).account
          }:function:elsa-data-*`,
        ],
      })
    );

    // restrict our Get operations to a very specific set of keys in the named buckets
    // NOTE: our 'signing' is always done by a different user so this is not the only
    // permission that has to be set correctly
    for (const [bucketName, keyWildcards] of Object.entries(dataBucketPaths)) {
      policy.addStatements(
        new PolicyStatement({
          actions: ["s3:GetObject"],
          // NOTE: we could consider restricting to region or account here in constructing the ARNS
          // but given the bucket names are already globally specific we leave them open
          resources: keyWildcards.map((k) => `arn:aws:s3:::${bucketName}/${k}`),
        })
      );
    }

    policy.addStatements(
      new PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: Object.keys(dataBucketPaths).map((b) => `arn:aws:s3:::${b}`),
      })
    );

    if (enableAccessPoints) {
      policy.addStatements(
        // temporarily give all S3 accesspoint perms - can we tighten?
        new PolicyStatement({
          actions: [
            "s3:CreateAccessPoint",
            "s3:DeleteAccessPoint",
            "s3:DeleteAccessPointPolicy",
            "s3:GetAccessPoint",
            "s3:GetAccessPointPolicy",
            "s3:GetAccessPointPolicyStatus",
            "s3:ListAccessPoints",
            "s3:PutAccessPointPolicy",
            "s3:PutAccessPointPublicAccessBlock",
          ],
          resources: [`*`],
        })
      );

      policy.addStatements(
        // access points need the ability to do CloudFormation
        // TODO: tighten the policy on the CreateStack as that is a powerful function
        //     possibly restrict the source of the template url
        //     possibly restrict the user enacting the CreateStack to only them to create access points
        new PolicyStatement({
          actions: [
            "cloudformation:CreateStack",
            "cloudformation:DescribeStacks",
            "cloudformation:DeleteStack",
          ],
          resources: [
            `arn:aws:cloudformation:${Stack.of(this).region}:${
              Stack.of(this).account
            }:stack/elsa-data-*`,
          ],
        })
      );
    }

    // for AwsDiscoveryService
    policy.addStatements(
      new PolicyStatement({
        actions: ["servicediscovery:DiscoverInstances"],
        resources: ["*"],
      })
    );

    return policy;
  }
}
