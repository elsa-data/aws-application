A very simple lambda whose job is to invoke Fargate
tasks.

The premise here is that we often want to spin up single use
Fargate tasks for the purposes of doing administration (i.e. database migrate).

This lambda can be installed via CloudFormation and will have
all the necessary Fargate settings from the CloudFormation stack. The lambda
can then simply be invoked from CLI/console.
