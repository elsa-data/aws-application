import {
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_route53 as route53,
  aws_secretsmanager as secretsmanager,
  CfnOutput,
  Duration,
  StackProps,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { Protocol } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { EdgeDbServiceConstruct } from "./edge-db-construct/edge-db-service-construct";
import { EdgeDbLoadBalancerConstruct } from "./edge-db-construct/edge-db-load-balancer-construct";
import { ISecret } from "aws-cdk-lib/aws-secretsmanager";

interface Props extends StackProps {
  // if set to true - changes the behaviour of most resources to be publicly accessible (still secure though)
  // also enables the EdgeDb UI on another port
  isDevelopment?: boolean;

  // a prefix that is used for constructing AWS secrets for postgres and edgedb
  // if empty - the default AWS naming is used (which are decent names but possibly uninformative of which postgres for instance)
  secretsPrefix?: string;

  // the underlying network infrastructure that has already been setup and that we will be installing into
  baseNetwork: {
    vpc: ec2.IVpc;

    hostedPrefix: string;
    hostedZone: route53.IHostedZone;
  };

  // the configuration of the fargate service that is edge db itself
  edgeDbService: {
    /**
     * The version string of EdgeDb that will be used for the spun up EdgeDb image.
     * Note that there are other EdgeDb dependencies inside the build of Elsa itself
     * (used to generate queries etc) - and so this is probably going to need
     * to align with those.
     */
    readonly version: string;

    /**
     * The DSN of the underlying postgres/rds instance
     */
    readonly baseDsn: string;

    superUser: string;
    desiredCount: number;
    cpu: number;
    memory: number;
    cert?: ecs.Secret;
    key?: ecs.Secret;
  };

  // the configuration of the network load balancer sitting in front of edge db
  edgeDbLoadBalancer: {
    port: number;

    // a publically accessible EdgeDb UI is only created if isDevelopment is true and this is filled in
    ui?: {
      port: number;
      certificate: ICertificate;
    };
  };
}

export class EdgeDbConstruct extends Construct {
  private readonly _dsn: string;
  private readonly _edgeDbPasswordSecret: ISecret;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    // create a new secret for our edge db database with an autogenerated password
    this._edgeDbPasswordSecret = new secretsmanager.Secret(
      this,
      "EdgeDbSecret",
      {
        secretName: props.secretsPrefix
          ? `${props.secretsPrefix}EdgeDbSecret`
          : undefined,
        generateSecretString: {
          excludePunctuation: true,
        },
      }
    );

    const edgeDbService = new EdgeDbServiceConstruct(this, "EdgeDbService", {
      isDevelopment: props.isDevelopment,
      vpc: props.baseNetwork.vpc,
      baseDbDsn: props.edgeDbService.baseDsn,
      desiredCount: props.edgeDbService.desiredCount,
      cpu: props.edgeDbService.cpu,
      memory: props.edgeDbService.memory,
      superUser: props.edgeDbService.superUser,
      superUserSecret: this._edgeDbPasswordSecret,
      // https://hub.docker.com/r/edgedb/edgedb/tags
      edgeDbVersion: props.edgeDbService.version,
      certificateCertSecret: props.edgeDbService.cert,
      certificateKeySecret: props.edgeDbService.key,
    });

    edgeDbService.service.connections.allowFromAnyIpv4(
      ec2.Port.tcp(edgeDbService.servicePort)
    );

    const edgeDbLoadBalancer = new EdgeDbLoadBalancerConstruct(
      this,
      "EdgeDbLoadBalancer",
      {
        isDevelopment: props.isDevelopment,
        vpc: props.baseNetwork.vpc,
        tcpPassthroughPort: props.edgeDbLoadBalancer.port,
        service: edgeDbService.service,
        servicePort: edgeDbService.servicePort,
        hostedPrefix: props.baseNetwork.hostedPrefix,
        hostedZone: props.baseNetwork.hostedZone,
        tlsTerminatePort: props.edgeDbLoadBalancer.ui?.port,
        tlsHostedCertificate: props.edgeDbLoadBalancer.ui?.certificate,
        serviceHealthCheck: {
          enabled: true,
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 2,
          protocol: Protocol.HTTPS,
          path: "/server/status/ready",
          interval: Duration.seconds(10),
        },
      }
    );

    // for the moment we are going with the flow of using the default edgedb database name.. if we go multi tenant etc
    // then we'd have to bring in this as a real variable
    const defaultEdgeDbName = "edgedb";

    this._dsn =
      `edgedb://` +
      `${props.edgeDbService.superUser}` +
      `@` +
      `${props.baseNetwork.hostedPrefix}.${props.baseNetwork.hostedZone.zoneName}` +
      `:` +
      `${props.edgeDbLoadBalancer.port}` +
      `/` +
      `${defaultEdgeDbName}`;

    new CfnOutput(this, "EdgeDbDsnNoPassword", {
      value: this._dsn,
    });

    // only in development mode is the UI switched on and accessible
    if (props.isDevelopment) {
      if (props.edgeDbLoadBalancer.ui) {
        new CfnOutput(this, "EdgeDbUiUrl", {
          value: `https://${props.baseNetwork.hostedPrefix}.${props.baseNetwork.hostedZone.zoneName}:${props.edgeDbLoadBalancer.ui.port}/ui`,
        });
      }
    }
  }

  public get dsnForEnvironmentVariable(): string {
    return this._dsn;
  }

  public get edgeDbPasswordSecret(): ISecret {
    return this._edgeDbPasswordSecret;
  }
}
