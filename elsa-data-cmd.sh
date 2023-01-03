#!/bin/zsh

#
# Executes admin commands inside the deployed Elsa Data environment
#

set -o errexit

# the namespace must pre-exist as a CloudMap namespace in the account of deployment
# these must match the values set in the elsa-data-pipeline-stack
CLOUD_MAP_NAMESPACE="umccr"
CLOUD_MAP_SERVICE="elsa-data"

# when deployed our CDK stack registers the lambda into the namespace
LAMBDA_ARN=$(aws servicediscovery discover-instances \
           --namespace-name "$CLOUD_MAP_NAMESPACE" \
           --service-name "$CLOUD_MAP_SERVICE" \
           --output text --query "Instances[].Attributes.lambdaArn")

echo "Task command executions can take a while - this CLI tool will wait (possibly 10 minutes)"

# annoyingly the aws lambda invoke *only* writes data into a file - can't output it to stdout
# so we make a temp file to hold the result and set a trap to delete it
temp_file=$(mktemp)

trap "rm -f $temp_file" 0 2 3 15

# our lambda knows how to pass cmd line strings to a spun up Elsa Data container just for CMD invoking
aws lambda invoke --function-name "$LAMBDA_ARN" \
           --cli-read-timeout 600 \
           --cli-binary-format raw-in-base64-out \
           --payload "{\"cmd\":\"$1\"}" \
           "$temp_file"

# the lambda returns details of where all its logs went
LG=$(jq < "$temp_file" -r '.logGroupName')
LS=$(jq < "$temp_file" -r '.logStreamName')

# and now we can print the log output (which is the admin command output)
aws logs tail "$LG" --log-stream-names "$LS" | cut -d' ' -f3-
