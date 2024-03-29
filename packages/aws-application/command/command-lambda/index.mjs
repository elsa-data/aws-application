import {
  DescribeTasksCommand,
  ECSClient,
  LaunchType,
  RunTaskCommand,
} from "@aws-sdk/client-ecs";

/**
 * Lambda handler that invokes a Fargate task and waits for completion.
 *
 * @param event
 * @returns {Promise<{logGroupName: any, logStreamName: string, message: string}|{error: string}|{details: string, error: string}>}
 */
export const handler = async (event) => {
  const client = new ECSClient({});

  // the only dynamic parameter of the lambda is the command string that should be passed to
  // the Task entrypoint
  const cmd = event.cmd;

  if (!cmd) {
    return {
      error: "Lambda must be invoked with a 'cmd' string field in the event",
    };
  }

  console.log(cmd);

  const clusterArn = process.env["CLUSTER_ARN"];
  const clusterLogGroupName = process.env["CLUSTER_LOG_GROUP_NAME"];
  const taskDefinitionArn = process.env["TASK_DEFINITION_ARN"];
  const containerName = process.env["CONTAINER_NAME"];
  const logStreamPrefix = process.env["LOG_STREAM_PREFIX"];
  const subnets = process.env["SUBNETS"];
  const securityGroups = process.env["SECURITY_GROUPS"];

  if (
    !clusterArn ||
    !clusterLogGroupName ||
    !taskDefinitionArn ||
    !containerName ||
    !logStreamPrefix ||
    !subnets ||
    !securityGroups
  )
    throw new Error(
      "Lambda must be invoked with cluster settings passed in via environment variables"
    );

  console.log(clusterArn);
  console.log(clusterLogGroupName);
  console.log(taskDefinitionArn);
  console.log(containerName);
  console.log(logStreamPrefix);
  console.log(subnets);
  console.log(securityGroups);

  const command = new RunTaskCommand({
    cluster: clusterArn,
    taskDefinition: taskDefinitionArn,
    launchType: LaunchType.FARGATE,
    startedBy: "Command Invoke Lambda",
    overrides: {
      containerOverrides: [
        {
          name: containerName,
          command: [cmd],
          cpu: 512,
        },
      ],
    },
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: subnets.split(","),
        securityGroups: securityGroups.split(","),
      },
    },
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const result = await client.send(command);

  let logStreamName;

  if (result.tasks.length === 1) {
    const taskArn = result.tasks[0].taskArn;

    // whenever we know the task arn - we try to construct the name of the corresponding log stream
    // (this is a bit fragile and is dependent on only slightly documented AWS conventions)
    // (see AWSlogdriver for ECS)
    const taskArnSplit = taskArn.split("/");

    if (taskArnSplit.length === 3) {
      logStreamName = `${logStreamPrefix}/${containerName}/${taskArnSplit[2]}`;
    }

    let lastStatus = result.tasks[0].lastStatus;

    while (lastStatus !== "STOPPED") {
      const waitResult = await client.send(
        new DescribeTasksCommand({
          cluster: clusterArn,
          tasks: [taskArn],
        })
      );

      console.log(JSON.stringify(waitResult, null, 2));

      lastStatus = waitResult.tasks[0].lastStatus;

      await sleep(10000);
    }

    // we return the log group name and stream name so the bash invoker can fetch all
    // the messages and display them to the user
    return {
      message: "Success",
      logGroupName: clusterLogGroupName,
      logStreamName: logStreamName,
    };
  }

  return { error: "Task not started", details: JSON.stringify(result) };
};
