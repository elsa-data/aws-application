# Application manual deploy

> :warning: \*_You must also build the workload CDK or this will not work_! See below

This CDK is for direct deployment to the UMCCR dev account
from a developers machine.

This is for testing the application CDK stack itself (and in
some part to test the actual deployment). That is, it answers questions like
have we configured the CDK security groups correctly so that they can talk
to the database.

It is designed for rapid development so does not use CI pipelines -
it directly deploys the locally built solution - whatever is on the devs machine
gets deployed.

NOTE: THE CDK DEPLOYED IS THAT WHICH HAS BEEN BUILT IN THE WORKLOAD FOLDER

This project uses a local package reference in `package.json` - which means that
the referred package is not "built" when we do an `npm install`.

That means you need to open another window and do a `npm run build` or
`npm run build:watch` (in the `workload-elsa-data-aws-application` folder)
to make sure that this CDK deployment is "up to date".

`npm run deploy`
