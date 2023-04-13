import { Stage, StageProps, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import { TAG_STACK_VALUE } from "./elsa-data-constants";

export class ElsaDataBuildStage extends Stage {
  constructor(
    scope: Construct,
    id: string,
    props: StageProps & ElsaDataStackSettings
  ) {
    super(scope, id, props);

    const stack = new ElsaDataStack(this, "ElsaData", props);

    Tags.of(stack).add("Stack", TAG_STACK_VALUE);
  }
}
