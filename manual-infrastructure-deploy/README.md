# Infrastructure for Elsa Data deployment

A generally usable infrastructure stack that should be
deployed directly to an account.

Its stack name should then be passed to 'application' stacks
where they can import all the settings that are important.

Infrastructure includes

- an optional VPC (or re-use an existing one)
- a RDS postgres instance
- a S3 bucket for temp objects
- a SSL wildcard certificate
