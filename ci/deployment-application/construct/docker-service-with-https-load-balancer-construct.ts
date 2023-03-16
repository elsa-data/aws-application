import { Construct } from "constructs";
import { IHostedZone } from "aws-cdk-lib/aws-route53";
import { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { SslPolicy } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {
  IVpc,
  SecurityGroup,
  SubnetSelection,
  SubnetType,
} from "aws-cdk-lib/aws-ec2";
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns";
import {
  Cluster,
  ContainerImage,
  CpuArchitecture,
  FargateTaskDefinition,
  LogDrivers,
  OperatingSystemFamily,
  Secret,
} from "aws-cdk-lib/aws-ecs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Duration } from "aws-cdk-lib";

type Props = {
  // the VPC to place the cluster in
  vpc: IVpc;

  // the details of the domain name entry to construct as the ALB entrypoint
  hostedPrefix: string;
  hostedZone: IHostedZone;
  hostedZoneCertificate: ICertificate;

  // the Docker image to run as the service
  containerImage: ContainerImage;

  // env variables to pass to the Docker image
  environment: { [p: string]: string };

  // secrets that can be expanded out in the environment on spin up (hidden from AWS console) NOTE: ecs Secrets, not Secret Manager secrets
  secrets: { [p: string]: Secret };

  // details of the fargate
  memoryLimitMiB: number;
  cpu: number;
  cpuArchitecture: CpuArchitecture;
  containerName: string;
  logStreamPrefix: string;
  logRetention: RetentionDays;

  desiredCount: number;
  healthCheckPath?: string;
};

/**
 * Creates a Docker based service in Fargate fronted by a SSL load balancer.
 */
export class DockerServiceWithHttpsLoadBalancerConstruct extends Construct {
  public readonly cluster: Cluster;
  public readonly clusterSecurityGroup: SecurityGroup;
  public readonly clusterLogGroup: LogGroup;
  public readonly clusterSubnetSelection: SubnetSelection = {
    subnetType: SubnetType.PRIVATE_WITH_EGRESS,
  };

  public readonly service: ApplicationLoadBalancedFargateService;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    // a cluster to run things on (will end up being a fargate cluster - so not actual ec2 instances)
    this.cluster = new Cluster(this, "Cluster", {
      vpc: props.vpc,
    });

    this.clusterLogGroup = new LogGroup(this, "ServiceLog", {
      retention: props.logRetention,
    });

    // we prefer to create our own security group even though it is probably no different from the default
    this.clusterSecurityGroup = new SecurityGroup(
      this,
      "ClusterSecurityGroup",
      {
        vpc: props.vpc,
        allowAllOutbound: true,
      }
    );

    // we do the task definition by hand as we have some specialised settings
    const taskDefinition = new FargateTaskDefinition(this, "TaskDefinition", {
      runtimePlatform: {
        operatingSystemFamily: OperatingSystemFamily.LINUX,
        cpuArchitecture: props.cpuArchitecture,
      },
      memoryLimitMiB: props.memoryLimitMiB,
      cpu: props.cpu,
      // were we to need to make these anything but default this is where
      // executionRole: taskImageOptions.executionRole,
      // taskRole: taskImageOptions.taskRole,
      // family: taskImageOptions.family,
    });

    const containerName = props.containerName;
    const container = taskDefinition.addContainer(containerName, {
      image: props.containerImage,
      cpu: props.cpu,
      memoryLimitMiB: props.memoryLimitMiB,
      environment: props.environment,
      secrets: props.secrets,
      logging: LogDrivers.awsLogs({
        streamPrefix: props.logStreamPrefix,
        logGroup: this.clusterLogGroup,
      }),
    });
    container.addPortMappings({
      containerPort: 80,
    });

    // a load balanced fargate service hosted on an SSL host
    this.service = new ApplicationLoadBalancedFargateService(this, "Service", {
      cluster: this.cluster,
      certificate: props.hostedZoneCertificate,
      sslPolicy: SslPolicy.RECOMMENDED,
      domainName: `${props.hostedPrefix}.${props.hostedZone.zoneName}`,
      domainZone: props.hostedZone,
      redirectHTTP: true,
      desiredCount: props.desiredCount,
      publicLoadBalancer: true,
      taskDefinition: taskDefinition,
      taskSubnets: this.clusterSubnetSelection,
      securityGroups: [this.clusterSecurityGroup],
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
