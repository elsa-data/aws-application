
# we have a sensible default - but this lets our CDK build override this using --build-arg ELSA_DATA_BASE_IMAGE=localimage:latest
ARG ELSA_DATA_BASE_IMAGE

# =ghcr.io/umccr/elsa-data:latest

# use a dynamic base
FROM $ELSA_DATA_BASE_IMAGE

# add in specific configs for AG
COPY datasets.json5 /extra-config/
