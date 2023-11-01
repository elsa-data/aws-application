import { aws_ec2 as ec2, CfnOutput, Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  Policy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { INamespace, Service } from "aws-cdk-lib/aws-servicediscovery";
import { ElsaDataApplicationSettings } from "../elsa-data-application-settings";
import * as apprunner from "@aws-cdk/aws-apprunner-alpha";
import {
  addAccessPointStatementsToPolicy,
  addBaseStatementsToPolicy,
} from "./elsa-data-application-shared";
import { getPolicyStatementsFromDataBucketPaths } from "../helper/bucket-names-to-policy";
import { ISecurityGroup, SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { ContainerConstruct } from "../construct/container-construct";
import { IHostedZone } from "aws-cdk-lib/aws-route53";
import { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { CfnWebACL, CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";

interface Props extends ElsaDataApplicationSettings {
  readonly vpc: ec2.IVpc;

  readonly container: ContainerConstruct;

  readonly cloudMapNamespace: INamespace;

  // in anticipation of app runner being able to make CNAME mappings automatically - currently not used
  readonly hostedZone?: IHostedZone;
  readonly hostedZoneCertificate?: ICertificate;

  readonly deployedUrl: string;

  // the security group of our edgedb - that we will put ourselves in to enable access
  readonly edgeDbSecurityGroup: ISecurityGroup;

  // a policy statement that we need to add to our app service in order to give us access to the secrets
  readonly accessSecretsPolicyStatement: PolicyStatement;

  // a policy statement that we need to add to our app service in order to discover other services via cloud map
  readonly discoverServicesPolicyStatement: PolicyStatement;

  // an already created temp bucket we can use
  readonly tempBucket: IBucket;
}

/**
 * The stack for deploying the actual Elsa Data web application via AppRunner.
 */
export class ElsaDataApplicationAppRunnerConstruct extends Construct {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    // we need to give the Vpc Connector a security group that allows outward traffic
    // so that we can make AWS calls
    // the VPC connector would normally make this for us by default - but because we *also* want
    // to specify an edgedb security group - we must do it manually and set both
    const appSecurityGroup = new SecurityGroup(this, "AppRunnerSecurityGroup", {
      vpc: props.vpc,
      allowAllOutbound: true,
    });

    const vpcConnector = new apprunner.VpcConnector(this, "VpcConnector", {
      vpc: props.vpc,
      vpcSubnets: props.vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      }),
      securityGroups: [appSecurityGroup, props.edgeDbSecurityGroup],
    });

    const policy = new Policy(this, "AppRunnerServiceTaskPolicy");

    addBaseStatementsToPolicy(
      policy,
      Stack.of(this).partition,
      Stack.of(this).region,
      Stack.of(this).account,
      props.accessSecretsPolicyStatement,
      props.discoverServicesPolicyStatement,
      ...getPolicyStatementsFromDataBucketPaths(
        Stack.of(this).partition,
        props.awsPermissions.dataBucketPaths
      )
    );

    if (props.awsPermissions.enableAccessPoints)
      addAccessPointStatementsToPolicy(
        policy,
        Stack.of(this).partition,
        Stack.of(this).region,
        Stack.of(this).account
      );

    const role = new Role(this, "ServiceRole", {
      assumedBy: new ServicePrincipal("tasks.apprunner.amazonaws.com"),
    });

    role.attachInlinePolicy(policy);

    // 👇 grant access to bucket
    props.tempBucket.grantReadWrite(role);

    const appService = new apprunner.Service(this, "Service", {
      source: props.container.appRunnerSource,
      instanceRole: role,
      autoDeploymentsEnabled: false,
      vpcConnector: vpcConnector,
    });

    if (props.wafRules && props.wafRules.length > 0) {
      const cfnWebAcl = new CfnWebACL(this, "WebAcl", {
        defaultAction: {
          allow: {},
        },
        scope: "REGIONAL",
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: "MetricForWebACLCDK",
          sampledRequestsEnabled: true,
        },
        rules: props.wafRules,
      });

      new CfnWebACLAssociation(this, "WebAclAssociation", {
        resourceArn: appService.serviceArn,
        webAclArn: cfnWebAcl.attrArn,
      });
    }

    // register a cloudMapService for the Application in our namespace
    // chose a sensible default - but allow an alteration in case I guess someone might
    // want to run two Elsa *in the same infrastructure*
    const service = new Service(this, "CloudMapService", {
      namespace: props.cloudMapNamespace,
      name: "ApplicationRunner",
      description: "Web application",
    });

    service.registerNonIpInstance("CloudMapCustomAttributes", {
      customAttributes: {
        serviceUrl: appService.serviceUrl,
        deployedUrl: props.deployedUrl,
      },
    });

    new CfnOutput(this, "ElsaDataDeployUrl", {
      value: appService.serviceUrl,
    });
  }
}
