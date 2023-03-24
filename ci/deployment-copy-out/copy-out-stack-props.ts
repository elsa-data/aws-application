import { SubnetType } from "aws-cdk-lib/aws-ec2";
import { StackProps } from "aws-cdk-lib";

export interface CopyOutStackProps extends StackProps {
  isDevelopment?: boolean;

  /**
   * A previously installed stack providing us with network/db/storage/cert infrastructure
   * via cloud formation exports.
   */
  infrastructureStack: string;

  /**
   * The choice of what subnet in the VPC we want to run this copy operation.
   */
  infrastructureSubnetSelection: SubnetType;
}
