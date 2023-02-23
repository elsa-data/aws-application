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

  dns: {
    /**
     * The SSM parameter name for a parameter holding the DNS settings.
     * e.g. /cdk/domain_name  =>  dev.umccr.org
     */
    readonly hostedZoneNameSsm: string;
    readonly hostedZoneIdSsm: string;
    readonly hostedZoneCertificateArnSsm: string;
  } & {
    /**
     * The actual names for DNS settings direct as strings
     */
    readonly hostedZoneName?: string;
    readonly hostedZoneId?: string;
    readonly hostedZoneCertificateArn?: string;
  };

  serviceElsaData: {
    /**
     * The URL prefix (name before first dot in hostname).
     * This is something that is expected to be different per deployment (e.g. "elsa", "elsa-demo").
     * It is required as it forms part of the deployed Elsa Data URL.
     */
    readonly urlPrefix: string;

    /**
     * The local folder location for where CDK will be asked to build the
     * Elsa Data that is deployed. This allows use to build very customised
     * images for prod v demo for instance. The Dockerfile in this folder
     * should have a dynamic base FROM so that the base image can also
     * be specified here.
     */
    readonly imageFolder: string;

    /**
     * The Docker image name for the base image of Elsa Data that will use for
     * building each deployments image. See also `elsaDataImageFolder`.
     */
    readonly imageBaseName: string;

    /**
     * The memory assigned to the Elsa Data service
     */
    readonly memoryLimitMiB: number;

    /**
     * The cpu assigned to the Elsa Data service
     */
    readonly cpu: number;
  };

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
  };
}
