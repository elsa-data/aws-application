
# we have a sensible default - but this lets our CDK build override this using --build-arg ELSA_DATA_BASE_IMAGE=localimage:latest
ARG ELSA_DATA_BASE_IMAGE="ghcr.io/umccr/elsa-data:latest"

# use a dynamic base
FROM --platform=linux/amd64 $ELSA_DATA_BASE_IMAGE

COPY config /a/config

ENTRYPOINT [ "node", "server/dist/src/entrypoint.js" ]