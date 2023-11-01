import { CfnWebACL } from "aws-cdk-lib/aws-wafv2";

/**
 * The user settable settings for the Elsa Data application service.
 */
export interface ElsaDataApplicationSettings {
  /**
   * If present and true, declares this installation of the application to be development
   * level, and therefore removes some guard rails and checks. That is, certain
   * destructive operations like wiping the database can be performed without checks
   * if isDevelopment is true.
   */
  readonly isDevelopment?: boolean;

  /**
   * The URL prefix (name before first dot in hostname).
   * This is something that is expected to be different per deployment (e.g. "elsa", "elsa-demo").
   * It is required as it forms part of the deployed Elsa Data URL.
   * The rest of the URL is defined by the infrastructure the application is
   * installed into.
   */
  readonly urlPrefix?: string;

  /**
   * The full URL for those applications deployed into somewhere
   * with externally defined DNS. Note that this represents a URL
   * so *should* start with "https://".
   */
  readonly urlFull?: string;

  /**
   * If present instructs the deployment CDK to attempt to build
   * a custom image rather than use an image directly. If this is not present, the `imageBaseName`
   * will be used directly from its public registry.
   */
  readonly buildLocal?: ElsaDataApplicationBuildLocal;

  /**
   * The Docker image name for the base image of Elsa Data that will use for
   * building each deployments image OR for direct deployment.
   * This allows us to specify a precise
   * release tag per deployment - whilst still re-using a single Docker
   * setup. See also `buildLocal.folder`.
   */
  readonly imageBaseName: string;

  /**
   * The name of the database in our database instance - defaults to
   * something sensible if not present.
   */
  readonly databaseName?: string;

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
  readonly awsPermissions: ElsaDataApplicationAwsPermissions;

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
   * If present and non-empty - tells us to use these rules for establishing a WAF.
   * If not present, then no WAF is installed.
   */
  readonly wafRules?: CfnWebACL.RuleProperty[];
}

export interface ElsaDataApplicationBuildLocal {
  /**
   * A local folder location for where CDK will be asked to build the
   * Elsa Data to deploy.
   */
  readonly folder: string;

  readonly version?: string;
  readonly built?: string;
  readonly revision?: string;
}

export interface ElsaDataApplicationAwsPermissions {
  /**
   * Bucket paths. For each bucket shared by this Elsa Data, we list
   * the Keys within that bucket as wildcards. This goes to setting the precise S3
   * read permissions for the Elsa Data service.
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
}
