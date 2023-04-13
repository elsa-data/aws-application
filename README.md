# Elsa Data (AWS Deploy)

CDK stacks for deploying Elsa Data.

## Deployment

For this UMCCR pipeline, Elsa Data is deployed to

- [Dev](https://elsa.dev.umccr.org)

New deployments are triggered on commits to Github main. Promotion to production needs to
be approved manually in the builds account.

## Architecture

![architecture](./docs/ElsaData.drawio.svg)

## Maintenance

The `elsa-data-cmd.sh` is a tool that can be used to maintain backend configuration of the Elsa Data
instance. This means that it can trigger database migrations etc.

`elsa-data-cmd.sh` works by invoking a lambda which in turn triggers a Fargate Task to spin up
the desired admin command. _IT MUST BE INVOKED IN THE ACCOUNT OF THE DEPLOYMENT_. That is,
whereas all other build/deployment is controlled by CDK Pipelines rooted in the Build
account - the maintenance utility must be run from an AWS environment logged into the deployment
account (either Dev or Prod).
