import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import { CopyOutStackSettings } from "./copy-out-stack-settings";
import { Cluster } from "aws-cdk-lib/aws-ecs";
import { CopyOutStateMachineConstruct } from "./copy-out-state-machine-construct";
import { HttpNamespace, Service } from "aws-cdk-lib/aws-servicediscovery";

export class CopyOutStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps & CopyOutStackSettings
  ) {
    super(scope, id, props);

    const vpc = Vpc.fromLookup(this, "VPC", {
      vpcId: props.infrastructureVpcId,
    });

    const namespace = HttpNamespace.fromHttpNamespaceAttributes(
      this,
      "Namespace",
      {
        // this is a bug in the CDK definitions - this field is optional but not defined that way
        // passing an empty string does work
        namespaceArn: "",
        // this is also a bug? surely we should be able to look up a namespace just by name
        namespaceId: props.serviceRegistration.cloudMapId,
        namespaceName: props.serviceRegistration.cloudMapNamespace,
      }
    );

    const cluster = new Cluster(this, "FargateCluster", {
      vpc,
      enableFargateCapacityProviders: true,
    });

    cluster.addDefaultCapacityProviderStrategy([
      {
        capacityProvider: "FARGATE_SPOT",
        weight: 1,
      },
    ]);

    const service = new Service(this, "Service", {
      namespace: namespace,
      name: props.serviceRegistration.cloudMapServiceName,
      description: "Service for registering Copy Out components",
    });

    const sm = new CopyOutStateMachineConstruct(this, "State", {
      fargateCluster: cluster,
      namespaceService: service,
    });
  }
}
