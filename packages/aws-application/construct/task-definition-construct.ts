import { Construct } from "constructs";
import { ISecurityGroup } from "aws-cdk-lib/aws-ec2";
import {
  ContainerImage,
  CpuArchitecture,
  FargateTaskDefinition,
  LogDrivers,
  OperatingSystemFamily,
  Secret,
} from "aws-cdk-lib/aws-ecs";
import { ClusterConstruct } from "./cluster-construct";

type Props = {
  cluster: ClusterConstruct;

  // any security groups to place the cloudMapService in - alongside a security group we will ourselves construct
  securityGroups: ISecurityGroup[];

  // the Docker image to run as the cloudMapService
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
};

/**
 * Creates a Docker based cloudMapService in Fargate fronted by a SSL load balancer.
 */
export class TaskDefinitionConstruct extends Construct {
  public readonly taskDefinition: FargateTaskDefinition;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    // we do the task definition by hand as we have some specialised settings
    this.taskDefinition = new FargateTaskDefinition(this, "TaskDefinition", {
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
    const container = this.taskDefinition.addContainer(containerName, {
      image: props.containerImage,
      cpu: props.cpu,
      memoryLimitMiB: props.memoryLimitMiB,
      environment: props.environment,
      secrets: props.secrets,
      logging: LogDrivers.awsLogs({
        streamPrefix: props.logStreamPrefix,
        logGroup: props.cluster.clusterLogGroup,
      }),
    });
    container.addPortMappings({
      containerPort: 80,
    });
  }
}
