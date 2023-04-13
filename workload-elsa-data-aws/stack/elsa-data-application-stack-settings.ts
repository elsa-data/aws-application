/**
 * The user settable settings for the Elsa Data application service.
 * This type is not used directly as the Props of the stack because there are some other
 * computed items (like an IVpc) in our Props that don't come directly
 * from the user.
 */
export type ElsaDataApplicationStackSettings = {
  /**
   * The URL prefix (name before first dot in hostname).
   * This is something that is expected to be different per deployment (e.g. "elsa", "elsa-demo").
   * It is required as it forms part of the deployed Elsa Data URL. See the
   * 'dns' settings for other parts of the URL.
   */
  readonly urlPrefix: string;

  /**
   * A local folder location for where CDK will be asked to build the
   * Elsa Data to deploy. If this is not present, the `imageBaseName`
   * will be used directly from its public registry.
   */
  readonly imageFolder?: string;

  /**
   * The Docker image name for the base image of Elsa Data that will use for
   * building each deployments image OR for direct deployment.
   * This allows us to specify a precise
   * release tag per deployment - whilst still re-using a single Docker
   * setup. See also `imageFolder`.
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

  awsPermissions: {
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

    readonly enableAccessPoints: boolean;
  };

  /**
   * The memory assigned to the Elsa Data service
   */
  readonly memoryLimitMiB: number;

  /**
   * The cpu assigned to the Elsa Data service
   */
  readonly cpu: number;
};
