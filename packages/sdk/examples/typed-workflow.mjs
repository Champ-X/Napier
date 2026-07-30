import { createNapierClient, loadNapierWorkflow } from "../dist/index.js";

const [workspaceRoot, dataRoot] = process.argv.slice(2);
if (!workspaceRoot || !dataRoot) {
  throw new Error(
    "Usage: node typed-workflow.mjs <workspace-root> <data-root>",
  );
}

const requestSchema = {
  type: "object",
  properties: {
    text: { type: "string", minLength: 1, maxLength: 200 },
    publish: { type: "boolean" },
  },
  required: ["text", "publish"],
  additionalProperties: false,
};
const normalizedSchema = {
  type: "object",
  properties: {
    text: { type: "string", minLength: 1, maxLength: 200 },
  },
  required: ["text"],
  additionalProperties: false,
};
const reportSchema = {
  type: "object",
  properties: {
    message: { type: "string", minLength: 1, maxLength: 200 },
  },
  required: ["message"],
  additionalProperties: false,
};

const client = await createNapierClient({ workspaceRoot, dataRoot });
try {
  const defined = await client.defineWorkflow({
    name: "SDK typed draft",
    version: 1,
    description:
      "Normalize one typed request and conditionally publish its output.",
    plan: {
      objective: "Normalize and publish one typed SDK request.",
      steps: [
        {
          id: "normalize",
          title: "Normalize input",
          description: "Project the request into a bounded typed object.",
          verification: "The normalized text matches the request.",
        },
        {
          id: "publish",
          title: "Publish output",
          description: "Publish or retain the normalized draft.",
          verification: "The output matches the report schema.",
          dependsOn: ["normalize"],
        },
      ],
    },
    inputSchema: requestSchema,
    outputSchema: reportSchema,
    outputNodeId: "publish",
    nodes: [
      {
        id: "normalize",
        type: "deterministic",
        inputBindings: {
          workflow: { source: "workflow" },
        },
        inputSchema: {
          type: "object",
          properties: { workflow: requestSchema },
          required: ["workflow"],
          additionalProperties: false,
        },
        outputSchema: normalizedSchema,
        template: {
          kind: "object",
          properties: {
            text: { kind: "input", path: ["workflow", "text"] },
          },
        },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
      {
        id: "publish",
        type: "deterministic",
        inputBindings: {
          workflow: { source: "workflow" },
          normalized: { source: "node", nodeId: "normalize" },
        },
        inputSchema: {
          type: "object",
          properties: {
            workflow: requestSchema,
            normalized: normalizedSchema,
          },
          required: ["workflow", "normalized"],
          additionalProperties: false,
        },
        outputSchema: reportSchema,
        when: { path: ["workflow", "publish"], equals: true },
        skipOutput: { message: "Draft retained by SDK Workflow" },
        template: {
          kind: "object",
          properties: {
            message: { kind: "input", path: ["normalized", "text"] },
          },
        },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  });
  const workflow = loadNapierWorkflow(
    JSON.parse(JSON.stringify(defined.manifest)),
  );
  const eventTypes = [];
  const execution = await client.runWorkflow({
    workflow,
    input: { text: "Evidence-native SDK execution", publish: false },
    title: "SDK typed Workflow example",
    onEvent: (event) => {
      eventTypes.push(event.type);
    },
  });
  process.stdout.write(
    `${JSON.stringify({
      threadId: execution.threadId,
      planId: execution.planId,
      status: execution.status,
      output: execution.output,
      manifestSha256: workflow.manifest.contentSha256,
      runCount: execution.result.nodeResults.filter((node) => node.runId)
        .length,
      skippedNodeCount: execution.result.nodeResults.filter(
        (node) => node.status === "skipped",
      ).length,
      eventTypes,
    })}\n`,
  );
} finally {
  await client.close();
}
