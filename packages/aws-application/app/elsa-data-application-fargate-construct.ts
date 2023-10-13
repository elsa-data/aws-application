import { Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { DockerServiceWithHttpsLoadBalancerConstruct } from "../construct/docker-service-with-https-load-balancer-construct";
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { ISecurityGroup } from "aws-cdk-lib/aws-ec2";
import { INamespace, Service } from "aws-cdk-lib/aws-servicediscovery";
import { IHostedZone } from "aws-cdk-lib/aws-route53";
import { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { ElsaDataApplicationSettings } from "../elsa-data-application-settings";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { ClusterConstruct } from "../construct/cluster-construct";
import { ContainerConstruct } from "../construct/container-construct";
import { TaskDefinitionConstruct } from "../construct/task-definition-construct";
import { FargateService } from "aws-cdk-lib/aws-ecs";
import { getPolicyStatementsFromDataBucketPaths } from "../helper/bucket-names-to-policy";
import {
  addAccessPointStatementsToPolicy,
  addBaseStatementsToPolicy,
} from "./elsa-data-application-shared";

interface Props extends ElsaDataApplicationSettings {
  // the cluster to run the fargate tasks in
  readonly cluster: ClusterConstruct;

  // the container to run in fargate
  readonly container: ContainerConstruct;

  readonly taskDefinition: TaskDefinitionConstruct;

  readonly cloudMapNamespace: INamespace;

  readonly hostedZone: IHostedZone;
  readonly hostedZoneCertificate: ICertificate;

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
 * A construct that deploys Elsa Data as a Fargate service.
 */
export class ElsaDataApplicationFargateConstruct extends Construct {
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
          hostedPrefix: props.urlPrefix!,
          hostedZone: props.hostedZone,
          hostedZoneCertificate: props.hostedZoneCertificate,
          desiredCount: props.desiredCount ?? 1,
          healthCheckPath: "/api/health/check",
        }
      );

    const policy = new Policy(this, "FargateServiceTaskPolicy");

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

    // the permissions of the running container (i.e. all AWS functionality used by Elsa Data code)
    this.privateServiceWithLoadBalancer.service.taskDefinition.taskRole.attachInlinePolicy(
      policy
    );

    // 👇 grant access to bucket
    props.tempBucket.grantReadWrite(
      this.privateServiceWithLoadBalancer.service.taskDefinition.taskRole
    );

    // register a cloudMapService for the Application in our namespace
    // chose a sensible default - but allow an alteration in case I guess someone might
    // want to run two Elsa *in the same infrastructure*
    const service = new Service(this, "CloudMapService", {
      namespace: props.cloudMapNamespace,
      name: "Application",
      description: "Web application",
    });

    service.registerNonIpInstance("CloudMapCustomAttributes", {
      customAttributes: {
        deployedUrl: props.deployedUrl,
      },
    });
  }

  public fargateService(): FargateService {
    return this.privateServiceWithLoadBalancer.service.service;
  }
}
