import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";

export function addBaseStatementsToPolicy(
  policy: Policy,
  partition: string,
  region: string,
  account: string,
  ...statement: PolicyStatement[]
) {
  for (const s of statement ?? []) {
    policy.addStatements(s);
  }

  // allow cloudtrail queries to get data egress records
  policy.addStatements(
    new PolicyStatement({
      actions: ["cloudtrail:StartQuery", "cloudtrail:GetQueryResults"],
      resources: ["*"],
    })
  );

  // allow sending emails through SES via Node Mailer (https://nodemailer.com/transports/ses/)
  policy.addStatements(
    new PolicyStatement({
      actions: ["ses:SendRawEmail"],
      resources: ["*"],
    })
  );

  // allow starting our steps copy out and any lookup operations we need to perform
  policy.addStatements(
    new PolicyStatement({
      actions: ["states:StartExecution"],
      resources: [
        `arn:${partition}:states:${region}:${account}:stateMachine:CopyOut*`,
      ],
    }),
    new PolicyStatement({
      actions: [
        "states:StopExecution",
        "states:DescribeExecution",
        "states:ListMapRuns",
      ],
      resources: [
        `arn:${partition}:states:${region}:${account}:execution:CopyOut*:*`,
      ],
    }),
    new PolicyStatement({
      actions: ["states:DescribeMapRun"],
      resources: [
        `arn:${partition}:states:${region}:${account}:mapRun:CopyOut*/*:*`,
      ],
    })
  );

  // for some of our scaling out work (Beacon etc) - we are going to make Lambdas that we want to be able to invoke
  // again we wildcard to a designated prefix of elsa-data*
  // TODO parameterise this to not have a magic string
  policy.addStatements(
    new PolicyStatement({
      actions: ["lambda:InvokeFunction"],
      resources: [
        `arn:${partition}:lambda:${region}:${account}:function:elsa-data-*`,
      ],
    })
  );

  // allow discovery
  policy.addStatements(
    new PolicyStatement({
      actions: ["servicediscovery:DiscoverInstances"],
      resources: ["*"],
    })
  );
}

export function addAccessPointStatementsToPolicy(
  policy: Policy,
  partition: string,
  region: string,
  account: string
) {
  // TODO consider moving all the "write" permissions here to be a CMD level (i.e. cluster admins only)
  // and only have "read" permissions here
  policy.addStatements(
    // temporarily give all S3 accesspoint perms - can we tighten?
    new PolicyStatement({
      actions: [
        "s3:CreateAccessPoint",
        "s3:DeleteAccessPoint",
        "s3:DeleteAccessPointPolicy",
        "s3:GetAccessPoint",
        "s3:GetAccessPointPolicy",
        "s3:GetAccessPointPolicyStatus",
        "s3:ListAccessPoints",
        "s3:PutAccessPointPolicy",
        "s3:PutAccessPointPublicAccessBlock",
      ],
      resources: [`*`],
    })
  );

  policy.addStatements(
    // access points need the ability to do CloudFormation
    // TODO: tighten the policy on the CreateStack as that is a powerful function
    //     possibly restrict the source of the template url
    //     possibly restrict the user enacting the CreateStack to only them to create access points
    new PolicyStatement({
      actions: [
        "cloudformation:CreateStack",
        "cloudformation:DescribeStacks",
        "cloudformation:DeleteStack",
      ],
      resources: [
        `arn:${partition}:cloudformation:${region}:${account}:stack/elsa-data-*`,
      ],
    })
  );
}
