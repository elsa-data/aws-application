import { ElsaDataApplicationStackSettings } from "./stack/elsa-data-application-stack-settings";

type Only<T, U> = {
  [P in keyof T]: T[P];
} & {
  [P in keyof U]?: never;
};

type Either<T, U> = Only<T, U> | Only<U, T>;

type DnsSettingSsm = {
  /**
   * The SSM parameter name for a parameter holding the DNS settings.
   * e.g. /cdk/domain_name  =>  dev.umccr.org
   */
  readonly hostedZoneNameSsm: string;
  readonly hostedZoneIdSsm: string;
  readonly hostedZoneCertificateArnSsm: string;
};

type DnsSettingsName = {
  /**
   * The actual names for DNS settings direct as strings
   */
  readonly hostedZoneName: string;
  readonly hostedZoneId: string;
  readonly hostedZoneCertificateArn: string;
};

export interface ElsaDataStackSettings {
  /**
   * Changes the behaviour of most resources (databases etc) to be publicly
   * accessible (albeit secure/password protected)
   */
  isDevelopment?: boolean;

  /**
   * The details of where we will register the services provided by this stack.
   * The underlying CloudMap must already exist.
   */
  serviceRegistration: {
    /**
     * The namespace we will register services in - for administrator use by our elsa-data-cmd tool
     */
    readonly cloudMapNamespace: string;

    /**
     * The id of the above namespace
     */
    readonly cloudMapId: string;

    /**
     * The service name for registering in cloudmap (can be used to distinguish between multiple Elsa Data
     * in the same namespace). Would normally be "elsa-data".
     */
    readonly cloudMapServiceName: string;
  };

  network: {
    /**
     * Controls the VPC that will be used, defaulted to, or constructed.
     * See vpc.ts.
     */
    readonly vpcNameOrDefaultOrNull: string | "default" | null;
  };

  dns: Either<DnsSettingSsm, DnsSettingsName>;

  serviceElsaData: ElsaDataApplicationStackSettings;

  serviceEdgeDb: {
    /**
     * The version string of EdgeDb that will be used for the spun up EdgeDb image.
     * Note that there are other EdgeDb dependencies inside the build of Elsa itself
     * (used to generate queries etc) - and so this is probably going to need
     * to align with those.
     */
    readonly version: string;

    /**
     * The memory assigned to the Edge Db service
     */
    readonly memoryLimitMiB: number;

    /**
     * The cpu assigned to the Edge Db service
     */
    readonly cpu: number;

    /**
     * The db URL prefix (name before first dot in hostname) - if
     * the database has been made public via isDevelopment.
     */
    readonly dbUrlPrefix?: string;

    /**
     * The db URL port - if
     * the database has been made public via isDevelopment.
     */
    readonly dbUrlPort?: number;
    readonly dbUiUrlPort?: number;
  };
}
