import { Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { DockerServiceWithHttpsLoadBalancerConstruct } from "../construct/docker-service-with-https-load-balancer-construct";
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { ISecurityGroup } from "aws-cdk-lib/aws-ec2";
import { Service } from "aws-cdk-lib/aws-servicediscovery";
import { IHostedZone } from "aws-cdk-lib/aws-route53";
import { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { ElsaDataApplicationSettings } from "../elsa-data-application-settings";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { ClusterConstruct } from "../construct/cluster-construct";
import { ContainerConstruct } from "../construct/container-construct";
import { TaskDefinitionConstruct } from "../construct/task-definition-construct";
import { FargateService } from "aws-cdk-lib/aws-ecs";
import { getPolicyStatementsFromDataBucketPaths } from "../helper/bucket-names-to-policy";

interface Props extends ElsaDataApplicationSettings {
  readonly cluster: ClusterConstruct;

  readonly container: ContainerConstruct;

  readonly taskDefinition: TaskDefinitionConstruct;

  readonly cloudMapService: Service;

  readonly hostedZone: IHostedZone;
  readonly hostedZoneCertificate: ICertificate;

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
 * A construct that deploys Elsa Data as a Fargate service.
 */
export class ElsaDataApplicationConstruct extends Construct {
  private readonly privateServiceWithLoadBalancer: DockerServiceWithHttpsLoadBalancerConstruct;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    this.privateServiceWithLoadBalancer =
      new DockerServiceWithHttpsLoadBalancerConstruct(
        this,
        "PrivateServiceWithLb",
        {
          cluster: props.cluster,
          taskDefinition: props.taskDefinition,
          // we need to at least be placed in the EdgeDb security group so that we can access EdgeDb
          securityGroups: [props.edgeDbSecurityGroup],
          hostedPrefix: props.urlPrefix,
          hostedZone: props.hostedZone,
          hostedZoneCertificate: props.hostedZoneCertificate,
          desiredCount: props.desiredCount ?? 1,
          healthCheckPath: "/api/health/check",
        }
      );

    const policy = new Policy(this, "FargateServiceTaskPolicy");

    // need to be able to fetch secrets but the infrastructure can give us a wildcard
    // policy statement that does that
    policy.addStatements(props.accessSecretsPolicyStatement);

    // need to be able to discover instances in the cloud map namespace - and our
    // infrastructure can give us a policy statement to enable that
    policy.addStatements(props.discoverServicesPolicyStatement);

    // we (currently) give the application access to all the data bucket objects
    // TODO consider subsetting even this permissions (only manifests??)
    policy.addStatements(
      ...getPolicyStatementsFromDataBucketPaths(
        Stack.of(this).partition,
        props.awsPermissions.dataBucketPaths
      )
    );

    // allow cloudtrail queries to get data egress records
    policy.addStatements(
      new PolicyStatement({
        actions: ["cloudtrail:StartQuery", "cloudtrail:GetQueryResults"],
        resources: ["*"],
      })
    );

    if (props.awsPermissions.enableAccessPoints) {
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
            `arn:${Stack.of(this).partition}:cloudformation:${
              Stack.of(this).region
            }:${Stack.of(this).account}:stack/elsa-data-*`,
          ],
        })
      );
    }

    // allow starting our steps copy out and any lookup operations we need to perform
    policy.addStatements(
      new PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [
          `arn:${Stack.of(this).partition}:states:${Stack.of(this).region}:${
            Stack.of(this).account
          }:stateMachine:CopyOut*`,
        ],
      }),
      new PolicyStatement({
        actions: [
          "states:StopExecution",
          "states:DescribeExecution",
          "states:ListMapRuns",
        ],
        resources: [
          `arn:${Stack.of(this).partition}:states:${Stack.of(this).region}:${
            Stack.of(this).account
          }:execution:CopyOut*:*`,
        ],
      }),
      new PolicyStatement({
        actions: ["states:DescribeMapRun"],
        resources: [
          `arn:${Stack.of(this).partition}:states:${Stack.of(this).region}:${
            Stack.of(this).account
          }:mapRun:CopyOut*/*:*`,
        ],
      })
    );

    // for some of our scaling out work (Beacon etc) - we are going to make Lambdas that we want to be able to invoke
    // again we wildcard to a designated prefix of elsa-data*
    // TODO parameterise this to not have a magic string
    policy.addStatements(
      new PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [
          `arn:${Stack.of(this).partition}:lambda:${Stack.of(this).region}:${
            Stack.of(this).account
          }:function:elsa-data-*`,
        ],
      })
    );

    // allow discovery
    policy.addStatements(
      new PolicyStatement({
        actions: ["servicediscovery:DiscoverInstances"],
        resources: ["*"],
      })
    );

    // the permissions of the running container (i.e all AWS functionality used by Elsa Data code)
    this.privateServiceWithLoadBalancer.service.taskDefinition.taskRole.attachInlinePolicy(
      policy
    );

    // 👇 grant access to bucket
    props.tempBucket.grantReadWrite(
      this.privateServiceWithLoadBalancer.service.taskDefinition.taskRole
    );
  }

  public fargateService(): FargateService {
    return this.privateServiceWithLoadBalancer.service.service;
  }
}
