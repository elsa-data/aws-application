import { ElsaDataApplicationSettings } from "./app/elsa-data-application-settings";
export {
  ElsaDataApplicationSettings,
  ElsaDataApplicationBuildLocal,
  ElsaDataApplicationAwsPermissions,
} from "./app/elsa-data-application-settings";

export interface ElsaDataStackSettings extends ElsaDataApplicationSettings {
  /**
   * The name of a previously installed stack providing us with network/db/storage/cert infrastructure
   * via SSM exports.
   */
  readonly infrastructureStackName: string;

  /**
   * The infrastructure name of the RDS/EdgeDb instance we want to use. This name is
   * set in our infrastructure stack - it may not match any actual AWS resource name. See
   * the output SSM of the infrastructure stack to see what databases are exported.
   */
  readonly infrastructureDatabaseName: string;
}
