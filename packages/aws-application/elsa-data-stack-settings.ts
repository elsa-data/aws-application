import { ElsaDataApplicationSettings } from "./elsa-data-application-settings";
export {
  ElsaDataApplicationSettings,
  ElsaDataApplicationBuildLocal,
  ElsaDataApplicationDatabaseSource,
  ElsaDataApplicationAwsPermissions,
} from "./elsa-data-application-settings";

export interface ElsaDataStackSettings extends ElsaDataApplicationSettings {
  /**
   * The name of a previously installed stack providing us with network/db/storage/cert infrastructure
   * via SSM exports.
   */
  readonly infrastructureStackName: string;
}
