import {ElsaDataApplicationStackSettings} from "./stack/elsa-data-application-stack-settings";

type Only<T, U> = {
  [P in keyof T]: T[P];
} & {
  [P in keyof U]?: never;
};

type Either<T, U> = Only<T, U> | Only<U, T>;

export interface ElsaDataStackSettings {
  /**
   * Changes the behaviour of most resources (databases etc) to be publicly
   * accessible (albeit secure/password protected)
   */
  isDevelopment?: boolean;

  /**
   * Forces a new deployment of all stacks by updating the description. Defaults to false.
   */
  forceDeployment?: boolean;

  /**
   * The name of a previously installed stack providing us with network/db/storage/cert infrastructure
   * via cloud formation exports.
   */
  infrastructureStackName: string;

  /**
   * The details of where we will register the services provided by this stack.
   */
  serviceRegistration: {
    /**
     * The service name for registering in cloudmap (can be used to distinguish between multiple Elsa Data
     * in the same namespace). Would normally be "elsa-data".
     */
    readonly cloudMapServiceName: string;
  };

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
     * Prefix to use for secrets.
     */
    readonly secretPrefix: string;

    /**
     * The db URL port - if
     * the database has been made public via isDevelopment.
     */
    readonly dbUrlPort?: number;
    readonly dbUiUrlPort?: number;
  };
}
