export interface CopyOutStackSettings {
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

  /**
   * A previously installed stack providing us with network/db/storage/cert infrastructure
   * via cloud formation exports.
   */
  infrastructureStack: string;

  /**
   * This is an annyoing one - we do a Vpc.fromLookup using values imported from other
   * stacks so we need to put it here. Infrastructure stacks are pretty stable (especially
   * the vpcId) so this is straightforward.
   */
  infrastructureVpcId: string;
}
