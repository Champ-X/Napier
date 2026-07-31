import type {
  ExecutionPlanWorkflowManifest,
  WorkflowObjectSchema,
} from "@napier/contracts";
import {
  createLocalAgentRuntime,
  UnsupportedSandboxAdapter,
} from "@napier/runtime";

export async function defineRpcWorkflowManifest(input: {
  workspaceRoot: string;
  dataRoot: string;
}): Promise<ExecutionPlanWorkflowManifest> {
  const services = await createLocalAgentRuntime({
    ...input,
    sandbox: new UnsupportedSandboxAdapter("rpc-workflow-fixture"),
  });
  try {
    const requestSchema = objectSchema({
      text: { type: "string", minLength: 1, maxLength: 200 },
    });
    const resultSchema = objectSchema({
      message: { type: "string", minLength: 1, maxLength: 200 },
    });
    return (
      await services.embeddedWorkflows.define({
        name: "RPC typed delivery",
        version: 1,
        description:
          "Project one typed request through a deterministic Workflow.",
        plan: {
          objective: "Deliver one typed result through RPC.",
          steps: [
            {
              id: "deliver",
              title: "Deliver result",
              description: "Project the request into the result schema.",
              verification: "The result matches the bound Workflow input.",
            },
          ],
        },
        inputSchema: requestSchema,
        outputSchema: resultSchema,
        outputNodeId: "deliver",
        nodes: [
          {
            id: "deliver",
            type: "deterministic",
            inputBindings: {
              workflow: { source: "workflow" },
            },
            inputSchema: objectSchema({ workflow: requestSchema }),
            outputSchema: resultSchema,
            template: {
              kind: "object",
              properties: {
                message: { kind: "input", path: ["workflow", "text"] },
              },
            },
            timeoutMs: 5_000,
            maxAttempts: 2,
          },
        ],
      })
    ).manifest;
  } finally {
    await services.shutdown();
  }
}

export async function defineRpcBlockedWorkflowManifest(input: {
  workspaceRoot: string;
  dataRoot: string;
}): Promise<ExecutionPlanWorkflowManifest> {
  const services = await createLocalAgentRuntime({
    ...input,
    sandbox: new UnsupportedSandboxAdapter("rpc-blocked-workflow-fixture"),
  });
  try {
    const requestSchema = objectSchema({
      text: { type: "string", minLength: 1, maxLength: 200 },
    });
    const resultSchema = objectSchema({
      message: { type: "string", minLength: 1, maxLength: 200 },
    });
    return (
      await services.embeddedWorkflows.define({
        name: "RPC blocked delivery",
        version: 1,
        description: "Exercise explicit Workflow retries through RPC.",
        plan: {
          objective: "Attempt one unavailable RPC Agent node.",
          steps: [
            {
              id: "deliver",
              title: "Deliver result",
              description: "Attempt delivery through an unavailable model.",
              verification: "The result matches the output schema.",
            },
          ],
        },
        inputSchema: requestSchema,
        outputSchema: resultSchema,
        outputNodeId: "deliver",
        nodes: [
          {
            id: "deliver",
            type: "agent",
            inputBindings: {
              workflow: { source: "workflow" },
            },
            inputSchema: objectSchema({ workflow: requestSchema }),
            outputSchema: resultSchema,
            model: {
              provider: "missing-rpc-provider",
              id: "missing-rpc-model",
            },
            timeoutMs: 5_000,
            maxAttempts: 2,
          },
        ],
      })
    ).manifest;
  } finally {
    await services.shutdown();
  }
}

function objectSchema(
  properties: WorkflowObjectSchema["properties"],
): WorkflowObjectSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
