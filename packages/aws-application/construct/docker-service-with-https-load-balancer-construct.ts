import { Construct } from "constructs";
import { IHostedZone } from "aws-cdk-lib/aws-route53";
import { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { SslPolicy } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { ISecurityGroup } from "aws-cdk-lib/aws-ec2";
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns";
import { Duration } from "aws-cdk-lib";
import { ClusterConstruct } from "./cluster-construct";
import { TaskDefinitionConstruct } from "./task-definition-construct";

type Props = {
  readonly cluster: ClusterConstruct;

  readonly taskDefinition: TaskDefinitionConstruct;

  // any security groups to place the cloudMapService in - alongside a security group we will ourselves construct
  readonly securityGroups: ISecurityGroup[];

  // the details of the domain name entry to construct as the ALB entrypoint
  readonly hostedPrefix: string;
  readonly hostedZone: IHostedZone;
  readonly hostedZoneCertificate: ICertificate;

  readonly desiredCount: number;
  readonly healthCheckPath?: string;
};

/**
 * Construct for a Docker based cloudMapService in Fargate fronted by a SSL load balancer.
 */
export class DockerServiceWithHttpsLoadBalancerConstruct extends Construct {
  public readonly service: ApplicationLoadBalancedFargateService;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    // a load balanced fargate cloudMapService hosted on an SSL host
    this.service = new ApplicationLoadBalancedFargateService(this, "Service", {
      cluster: props.cluster.cluster,
      certificate: props.hostedZoneCertificate,
      // meets AWS security controls ELB.17 - supports TLS 1.3 and TLS 1.2 with forward secrecy
      // note that the underlying policy string can evolve over time as the CDK/recommended changes
      sslPolicy: SslPolicy.TLS13_13,
      domainName: `${props.hostedPrefix}.${props.hostedZone.zoneName}`,
      domainZone: props.hostedZone,
      redirectHTTP: true,
      desiredCount: props.desiredCount,
      publicLoadBalancer: true,
      taskDefinition: props.taskDefinition.taskDefinition,
      taskSubnets: props.cluster.clusterSubnetSelection,
      securityGroups: [
        props.cluster.clusterSecurityGroup,
        ...props.securityGroups,
      ],
      circuitBreaker: {
        rollback: true,
      },
    });

    if (props.healthCheckPath) {
      this.service.targetGroup.configureHealthCheck({
        path: props.healthCheckPath,
        // https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/load-balancer-healthcheck.html
        interval: Duration.seconds(10),
        healthyThresholdCount: 2,
      });
    }
  }
}
