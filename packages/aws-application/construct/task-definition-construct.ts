import { Construct } from "constructs";
import {
  CpuArchitecture,
  FargateTaskDefinition,
  LogDrivers,
  OperatingSystemFamily,
  Secret,
} from "aws-cdk-lib/aws-ecs";
import { ClusterConstruct } from "./cluster-construct";
import { ContainerConstruct } from "./container-construct";

type Props = {
  // the cluster the task will run in
  readonly cluster: ClusterConstruct;

  // the container the task will consist of
  readonly container: ContainerConstruct;

  // env variables to pass to the Docker image
  readonly environment: { [p: string]: string };

  // secrets that can be expanded out in the environment on spin
  // up (hidden from AWS console) NOTE: ecs Secrets, not Secret Manager secrets
  readonly secrets: { [p: string]: Secret };

  // details of the fargate task
  readonly memoryLimitMiB: number;
  readonly cpu: number;
  readonly cpuArchitecture: CpuArchitecture;

  // a string that is sent to our AWS logger to be the stream prefix
  // needs to be recorded and available so that we can coordinate fetching of logs
  readonly logStreamPrefix: string;
};

/**
 * A construct for a TaskDefinition that can run our Elsa Data container.
 * This definition gets used for both the running 24/7 website AND for
 * one-off tasks that do "admin" work. They may get given different
 * permissions outside of this construct.
 */
export class TaskDefinitionConstruct extends Construct {
  public readonly taskDefinition: FargateTaskDefinition;
  public readonly logStreamPrefix: string;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    this.logStreamPrefix = props.logStreamPrefix;

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

    const container = this.taskDefinition.addContainer(
      props.container.containerName,
      {
        image: props.container.containerImage,
        cpu: props.cpu,
        memoryLimitMiB: props.memoryLimitMiB,
        environment: props.environment,
        secrets: props.secrets,
        logging: LogDrivers.awsLogs({
          streamPrefix: props.logStreamPrefix,
          logGroup: props.cluster.clusterLogGroup,
        }),
      }
    );
    container.addPortMappings({
      containerPort: 80,
    });
  }
}
