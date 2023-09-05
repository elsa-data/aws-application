import { Construct } from "constructs";
import {
  IVpc,
  SecurityGroup,
  SubnetSelection,
  SubnetType,
} from "aws-cdk-lib/aws-ec2";
import { Cluster } from "aws-cdk-lib/aws-ecs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";

type Props = {
  // the VPC to place the cluster in
  vpc: IVpc;

  logRetention: RetentionDays;
};

/**
 * Creates a cluster for running Docker tasks on.
 */
export class ClusterConstruct extends Construct {
  public readonly vpc: IVpc;
  public readonly cluster: Cluster;
  public readonly clusterSecurityGroup: SecurityGroup;
  public readonly clusterLogGroup: LogGroup;
  public readonly clusterSubnetSelection: SubnetSelection;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    this.vpc = props.vpc;

    this.clusterSubnetSelection = {
      subnetType: SubnetType.PRIVATE_WITH_EGRESS,
    };

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
  }
}
