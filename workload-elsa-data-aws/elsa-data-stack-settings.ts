import { ElsaDataApplicationStackSettings } from "./elsa-data-application/elsa-data-application-stack-settings";

export interface ElsaDataStackSettings {
  /**
   * Changes the behaviour of most resources (databases etc) to be publicly
   * accessible (albeit secure/password protected)
   */
  readonly isDevelopment?: boolean;

  /**
   * Forces a new deployment of all stacks by updating the description. Defaults to false.
   */
  readonly forceDeployment?: boolean;

  /**
   * The name of a previously installed stack providing us with network/db/storage/cert infrastructure
   * via cloud formation exports.
   */
  readonly infrastructureStackName: string;

  /**
   * The infrastructure name of the RDS/EdgeDb instance we want to use. This name is
   * set in our infrastructure stack - it may not match any actual AWS resource name. See
   * the output SSM of the infrastructure stack to see what databases are exported.
   */
  readonly infrastructureDatabaseName: string;

  serviceElsaData: ElsaDataApplicationStackSettings;
}
