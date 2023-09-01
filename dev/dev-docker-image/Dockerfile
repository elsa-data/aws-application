
# no default - this has to be set in the CDK doing e.g. --build-arg ELSA_DATA_BASE_IMAGE=ghcr.io/umccr/elsa-data:latest
ARG ELSA_DATA_BASE_IMAGE

FROM --platform=linux/amd64 $ELSA_DATA_BASE_IMAGE

COPY *.json5 /dev-config/

# add in barely filled IP lookup database
COPY Geoacumen-Country.mmdb /dev-config/
