/**
 * The user settable settings for the Elsa Data application service.
 */
export type ElsaDataApplicationSettings = {
  /**
   * The URL prefix (name before first dot in hostname).
   * This is something that is expected to be different per deployment (e.g. "elsa", "elsa-demo").
   * It is required as it forms part of the deployed Elsa Data URL.
   * The rest of the URL is defined by the infrastructure the application is
   * installed into.
   */
  readonly urlPrefix: string;

  /**
   * If present instructs the deployment CDK to attempt to build
   * a custom image rather than use an image directly. If this is not present, the `imageBaseName`
   * will be used directly from its public registry.
   */
  readonly buildLocal?: {
    /**
     * A local folder location for where CDK will be asked to build the
     * Elsa Data to deploy.
     */
    readonly folder: string;

    readonly version?: string;
    readonly built?: string;
    readonly revision?: string;
  };

  /**
   * The Docker image name for the base image of Elsa Data that will use for
   * building each deployments image OR for direct deployment.
   * This allows us to specify a precise
   * release tag per deployment - whilst still re-using a single Docker
   * setup. See also `buildLocal.folder`.
   */
  readonly imageBaseName: string;

  /**
   * For the above Docker images - we can add configuration files/folders
   * to the image. This allows us to extend the list of folder locations
   * from the default "./config";
   */
  readonly metaConfigFolders?: string;

  /**
   * This is the definitive list of configuration sources for this
   * deployment. It has no default.
   */
  readonly metaConfigSources: string;

  /**
   * Policy permissions need to be given to the container service
   * and this section helps define them (some of these values
   * would be derivable from the Elsa configuration but it is not
   * available at this point in deployment)
   */
  readonly awsPermissions: {
    /**
     * Bucket paths. For each bucket shared by this Elsa Data, we list
     * the Keys within that bucket as wildcards. This goes to setting the precise S3
     * read permissions for the Elsa service.
     * e.g.
     *  {
     *    "my-bucket": [ "Cardiac2022/*", "Mito/*manifest.txt" ]
     *  }
     */
    readonly dataBucketPaths: { [bucket: string]: string[] };

    /**
     * The access point sharing mechanism needs to be given broad
     * permissions to install CloudFormation - so if it is not
     * needed then the permissions can be skipped.
     */
    readonly enableAccessPoints: boolean;
  };

  /**
   * The desired count of number of Elsa Data application containers - defaults to 1
   */
  readonly desiredCount?: number;

  /**
   * The memory assigned to the Elsa Data application container - defaults to something sensible
   */
  readonly memoryLimitMiB?: number;

  /**
   * The cpu assigned to the Elsa Data application container - defaults to something sensible
   */
  readonly cpu?: number;

  /**
   * If present, an alternative CloudMap service name for the application - defaults to Application
   */
  readonly serviceName?: string;

  /**
   * If present, an alternative edgedb database name for the application - defaults to something sensible
   */
  readonly databaseName?: string;
};
