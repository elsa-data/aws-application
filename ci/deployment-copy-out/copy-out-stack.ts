import { Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { CopyOutStackProps } from "./copy-out-stack-props";
import { Cluster } from "aws-cdk-lib/aws-ecs";
import { CopyOutStateMachineConstruct } from "./construct/copy-out-state-machine-construct";
import { Service } from "aws-cdk-lib/aws-servicediscovery";
import { createFromAttributes } from "../../manual-infrastructure-deploy/create-from-lookup";

export class CopyOutStack extends Stack {
  constructor(scope: Construct, id: string, props: CopyOutStackProps) {
    super(scope, id, props);

    const { vpc, namespace } = createFromAttributes(
      this,
      props.infrastructureStack,
      true,
      true,
      false
    );

    const cluster = new Cluster(this, "FargateCluster", {
      vpc: vpc!,
      enableFargateCapacityProviders: true,
    });

    const service = new Service(this, "Service", {
      namespace: namespace!,
      name: "ElsaDataCopyOut",
      description: "Parallel S3 file copying service",
    });

    const sm = new CopyOutStateMachineConstruct(this, "CopyOut", {
      vpc: vpc!,
      fargateCluster: cluster,
      namespaceService: service,
      aggressiveTimes: props.isDevelopment,
    });
  }
}
