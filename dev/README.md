# Application manual deploy

> :warning: \*You must also build the workload CDK or this will not work! See below

This CDK is for direct deployment to the UMCCR dev account
from a developers machine.

This is for testing the application CDK stack itself (and in
some part to test the actual deployment). That is, it answers questions like
have we configured the CDK security groups correctly so that they can talk
to the database.

It is designed for rapid development so does not use CI pipelines -
it directly deploys the locally built solution - whatever is on the devs machine
gets deployed.

NOTE: THE CDK DEPLOYED IS THAT WHICH HAS BEEN BUILT IN
THE PACKAGES FOLDER - THAT IS THE COMPILED JAVASCRIPT
FILES AND NOT THE TYPESCRIPT

Open another window and do a `pnpm -w run watch` to make sure that
this CDK deployment is continuously being kept up to date. Then use `cdk`
directly.

-OR-

You can run CDK deploy/destroy steps that include a "pre-build".

`pnpm run deploy`
`pnpm run destroy`
