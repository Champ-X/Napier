import type {
  ExecutionPlanWorkflowManifest,
  WorkflowObjectSchema,
} from "@napier/contracts";
import { EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA } from "@napier/contracts";
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

export async function defineRpcExperimentWorkflowManifest(input: {
  workspaceRoot: string;
  dataRoot: string;
}): Promise<ExecutionPlanWorkflowManifest> {
  const services = await createLocalAgentRuntime({
    ...input,
    sandbox: new UnsupportedSandboxAdapter("rpc-experiment-workflow-fixture"),
  });
  try {
    const requestSchema = objectSchema({
      text: { type: "string", minLength: 1, maxLength: 200 },
    });
    const preparedSchema = objectSchema({
      normalized: { type: "string", minLength: 1, maxLength: 200 },
    });
    const resultSchema = objectSchema({
      message: { type: "string", minLength: 1, maxLength: 200 },
    });
    return (
      await services.embeddedWorkflows.define({
        name: "RPC checkpoint experiment",
        version: 1,
        description:
          "Reuse one deterministic ancestor and rerun its descendant.",
        plan: {
          objective: "Deliver one typed checkpoint experiment.",
          steps: [
            {
              id: "prepare",
              title: "Prepare request",
              description: "Normalize the typed request.",
              verification: "Return the normalized value.",
            },
            {
              id: "deliver",
              title: "Deliver result",
              description: "Project the normalized value into the result.",
              verification: "Return the typed result.",
              dependsOn: ["prepare"],
            },
          ],
        },
        inputSchema: requestSchema,
        outputSchema: resultSchema,
        outputNodeId: "deliver",
        nodes: [
          {
            id: "prepare",
            type: "deterministic",
            inputBindings: {
              workflow: { source: "workflow" },
            },
            inputSchema: objectSchema({ workflow: requestSchema }),
            outputSchema: preparedSchema,
            template: {
              kind: "object",
              properties: {
                normalized: { kind: "input", path: ["workflow", "text"] },
              },
            },
            timeoutMs: 5_000,
            maxAttempts: 2,
          },
          {
            id: "deliver",
            type: "deterministic",
            inputBindings: {
              prepared: { source: "node", nodeId: "prepare" },
            },
            inputSchema: objectSchema({ prepared: preparedSchema }),
            outputSchema: resultSchema,
            template: {
              kind: "object",
              properties: {
                message: { kind: "input", path: ["prepared", "normalized"] },
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

export async function defineRpcReduceWorkflowManifest(input: {
  workspaceRoot: string;
  dataRoot: string;
}): Promise<ExecutionPlanWorkflowManifest> {
  const services = await createLocalAgentRuntime({
    ...input,
    sandbox: new UnsupportedSandboxAdapter("rpc-reduce-workflow-fixture"),
  });
  try {
    const valuesSchema = {
      type: "array" as const,
      items: { type: "integer" as const },
      minItems: 0,
      maxItems: 16,
    };
    const requestSchema = objectSchema({ values: valuesSchema });
    return (
      await services.embeddedWorkflows.define({
        name: "RPC deterministic Reduce",
        version: 1,
        description: "Sum typed values through a model-free Reduce node.",
        plan: {
          objective: "Return one deterministic RPC sum.",
          steps: [
            {
              id: "total",
              title: "Total values",
              description: "Sum every typed integer.",
              verification: "Return the exact deterministic sum.",
            },
          ],
        },
        inputSchema: requestSchema,
        outputSchema: { type: "integer" },
        outputNodeId: "total",
        nodes: [
          {
            id: "total",
            type: "reduce",
            inputBindings: {
              values: { source: "workflow", path: ["values"] },
            },
            inputSchema: objectSchema({ values: valuesSchema }),
            outputSchema: { type: "integer" },
            itemsPath: ["values"],
            operation: "sum",
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

export async function defineRpcApprovalWorkflowManifest(input: {
  workspaceRoot: string;
  dataRoot: string;
}): Promise<ExecutionPlanWorkflowManifest> {
  const services = await createLocalAgentRuntime({
    ...input,
    sandbox: new UnsupportedSandboxAdapter("rpc-approval-workflow-fixture"),
  });
  try {
    const requestSchema = objectSchema({
      text: { type: "string", minLength: 1, maxLength: 200 },
    });
    const outputSchema = structuredClone(
      EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA,
    );
    return (
      await services.embeddedWorkflows.define({
        name: "RPC approval delivery",
        version: 1,
        description: "Pause and resume one Approval through RPC.",
        plan: {
          objective: "Approve one RPC delivery.",
          steps: [
            {
              id: "approve",
              title: "Approve delivery",
              description: "Wait for a fresh operator decision.",
              verification: "Return the bound Approval receipt.",
            },
          ],
        },
        inputSchema: requestSchema,
        outputSchema,
        outputNodeId: "approve",
        nodes: [
          {
            id: "approve",
            type: "approval",
            header: "Release",
            question: "Approve this RPC Workflow delivery?",
            approve: {
              label: "Approve",
              description: "Complete the typed Workflow.",
            },
            reject: {
              label: "Reject",
              description: "Block the typed Workflow.",
            },
            inputBindings: {
              workflow: { source: "workflow" },
            },
            inputSchema: objectSchema({ workflow: requestSchema }),
            outputSchema,
            timeoutMs: 60_000,
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
