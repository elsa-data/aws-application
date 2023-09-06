import { PolicyStatement } from "aws-cdk-lib/aws-iam";

/**
 * Construct a list of PolicyStatement objects that give us the desired
 * access to a user specified data buckets object.
 *
 * @param arnPartition
 * @param dataBucketPaths
 */
export function getPolicyStatementsFromDataBucketPaths(
  arnPartition: string,
  dataBucketPaths: { [bucket: string]: string[] }
) {
  const stmts: PolicyStatement[] = [];

  // restrict our Get operations to a very specific set of keys in the named buckets
  for (const [bucketName, keyWildcards] of Object.entries(dataBucketPaths)) {
    stmts.push(
      new PolicyStatement({
        actions: ["s3:GetObject"],
        // NOTE: we could consider restricting to region or account here in constructing the ARNS
        // but given the bucket names are already globally specific we leave them open
        resources: keyWildcards.map(
          (k) => `arn:${arnPartition}:s3:::${bucketName}/${k}`
        ),
      })
    );
  }

  stmts.push(
    new PolicyStatement({
      actions: ["s3:ListBucket"],
      resources: Object.keys(dataBucketPaths).map(
        (b) => `arn:${arnPartition}:s3:::${b}`
      ),
    })
  );

  return stmts;
}
