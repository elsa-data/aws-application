import { Construct } from "constructs";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import { ContainerImage } from "aws-cdk-lib/aws-ecs";
import { ElsaDataApplicationBuildLocal } from "../elsa-data-application-settings";

interface Props {
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
}

// we need a consistent name within the ECS infrastructure for our container
// there seems to be no reason why this would need to be configurable though, hence this constant
const FIXED_CONTAINER_NAME = "ElsaData";

/**
 * The stack for deploying the actual Elsa Data web application.
 */
export class ContainerConstruct extends Construct {
  // we allow our Elsa image to either be the straight Elsa image from the public repo
  // OR we will build a local Dockerfile to allow local changes to be made (config files
  // added etc)
  public readonly containerImage: ContainerImage;
  public readonly containerName = FIXED_CONTAINER_NAME;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    if (props.buildLocal) {
      // we construct a CDK deployed docker image with any minor alterations
      // we have made to the base image
      const buildLocal = props.buildLocal;

      const asset = new DockerImageAsset(this, "DockerImageAsset", {
        directory: buildLocal.folder,
        platform: Platform.LINUX_AMD64,
        // because the image base name is passed into Docker - the actual Docker checksum
        // itself won't change even when the image base does... so we need to add it into the hash
        extraHash: props.imageBaseName,
        buildArgs: {
          // pass this through to Docker so it can be used as a BASE if wanted
          ELSA_DATA_BASE_IMAGE: props.imageBaseName,
          // bring in custom Docker build values for Elsa to use if present
          ...(buildLocal.version && { ELSA_DATA_VERSION: buildLocal.version }),
          ...(buildLocal.built && { ELSA_DATA_BUILT: buildLocal.built }),
          ...(buildLocal.revision && {
            ELSA_DATA_REVISION: buildLocal.revision,
          }),
        },
      });
      this.containerImage = ContainerImage.fromDockerImageAsset(asset);
    } else {
      this.containerImage = ContainerImage.fromRegistry(
        props.imageBaseName,
        {}
      );
    }
  }
}
