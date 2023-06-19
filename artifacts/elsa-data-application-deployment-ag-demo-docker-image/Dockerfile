ARG ELSA_DATA_BASE_IMAGE

# use a dynamic base that MUST be specified as part of the CDK build step
FROM --platform=linux/amd64 $ELSA_DATA_BASE_IMAGE

# add in specific configs for AG
COPY *.json5 /ag-config/

# add in an AG logo
COPY ag-logo-200x.png /ag-config/

# add in IP lookup database
COPY GeoLite2-City.mmdb /ag-config/
