# Elsa Data (AWS Deploy)

A CDK stack for deploying the core Elsa Data application
into infrastructure.

## Dev

IF EDITING ANYTHING OTHER THAN THE DEV DEPLOYMENT
YOU MUST BE COMPILING THE CDK PACKAGES.

`pnpm watch`

in a window - will sit and recompile all package changes.

These can then be deployed to dev in the dev folder with
normal CDK operations.

## AWS Deploy (As Built)

![aws deploy as built](./docs/elsa-data-aws-deploy-as-built.drawio.svg)

## Data Flows

![data flows](./docs/elsa-data-ag-data-flow.drawio.svg)

## Maintenance

The `elsa-data-cmd.sh` is a tool that can be used to maintain backend configuration of the Elsa Data
instance. This means that it can trigger database migrations etc.

`elsa-data-cmd.sh` works by invoking a lambda which in turn triggers a Fargate Task to spin up
the desired admin command. _IT MUST BE INVOKED IN THE ACCOUNT OF THE DEPLOYMENT_. That is,
whereas all other build/deployment is controlled by CDK Pipelines rooted in the Build
account - the maintenance utility must be run from an AWS environment logged into the deployment
account (either Dev or Prod).
