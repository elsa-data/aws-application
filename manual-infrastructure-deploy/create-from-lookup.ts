import { aws_route53 as route53, Stack } from "aws-cdk-lib";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import { HttpNamespace } from "aws-cdk-lib/aws-servicediscovery";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";

/**
 * Create a useable (subnets etc) VPC CDK object by reflecting
 * the values out of parameter store.
 *
 * @param stack
 * @param infrastructureStackId
 */
export function createVpcFromLookup(
  stack: Stack,
  infrastructureStackId: string
) {
  const getStringListLookup = (n: string) => {
    return StringParameter.valueFromLookup(
      stack,
      `/${infrastructureStackId}/VPC/${n}`
    ).split(",");
  };

  return Vpc.fromVpcAttributes(stack, "VPC", {
    vpcId: StringParameter.valueFromLookup(
      stack,
      `/${infrastructureStackId}/VPC/vpcId`
    ),
    availabilityZones: getStringListLookup("availabilityZones"),
    publicSubnetIds: getStringListLookup("publicSubnetIds"),
    publicSubnetRouteTableIds: getStringListLookup("publicSubnetRouteTableIds"),
    privateSubnetIds: getStringListLookup("privateSubnetIds"),
    privateSubnetRouteTableIds: getStringListLookup(
      "privateSubnetRouteTableIds"
    ),
    isolatedSubnetIds: getStringListLookup("isolatedSubnetIds"),
    isolatedSubnetRouteTableIds: getStringListLookup(
      "isolatedSubnetRouteTableIds"
    ),
  });
}

/**
 * Create a useable CloudMap namespace object by reflecting values
 * out of Parameter Store.
 *
 * @param stack
 * @param infrastructureStackId
 */
export function createNamespaceFromLookup(
  stack: Stack,
  infrastructureStackId: string
) {
  return HttpNamespace.fromHttpNamespaceAttributes(stack, "Namespace", {
    namespaceArn: StringParameter.valueFromLookup(
      stack,
      `/${infrastructureStackId}/HttpNamespace/namespaceArn`
    ),
    namespaceId: StringParameter.valueFromLookup(
      stack,
      `/${infrastructureStackId}/HttpNamespace/namespaceId`
    ),
    namespaceName: StringParameter.valueFromLookup(
      stack,
      `/${infrastructureStackId}/HttpNamespace/namespaceName`
    ),
  });
}

/**
 * Create some useable DNS CDK objects by reflecting values out of Parameter
 * Store.
 *
 * @param stack
 * @param infrastructureStackId
 */
export function createDnsFromLookup(
  stack: Stack,
  infrastructureStackId: string
) {
  const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
    stack,
    "HostedZone",
    {
      hostedZoneId: StringParameter.valueFromLookup(
        stack,
        `/${infrastructureStackId}/HostedZone/hostedZoneId`
      ),
      zoneName: StringParameter.valueFromLookup(
        stack,
        `/${infrastructureStackId}/HostedZone/zoneName`
      ),
    }
  );

  const certificate = Certificate.fromCertificateArn(
    stack,
    "SslCert",
    StringParameter.valueFromLookup(
      stack,
      `/${infrastructureStackId}/Certificate/certificateArn`
    )
  );

  return {
    hostedZone,
    certificate,
  };
}
