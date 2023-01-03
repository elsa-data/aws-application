export interface ElsaDataStackSettings {
  /**
   * The namespace we will register services in - for location by our elsa-data-cmd tool
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

  /**
   * The host name prefix (name before first dot in hostname)
   */
  readonly hostedPrefix: string;

  /**
   * The memory assigned to the service
   */
  readonly memoryLimitMiB: number;

  /**
   * The cpu assigned to the service
   */
  readonly cpu: number;
}
