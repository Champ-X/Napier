import type {
  CreateExecutionPlanRequest,
  ExecutionPlanBlueprint,
  WorkflowObjectSchema,
} from "@napier/contracts";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalStore } from "../src/store.js";
import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";

export const workflowManifestTemporaryRoots: string[] = [];

export function requestSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      request: { type: "string", minLength: 1, maxLength: 500 },
    },
    required: ["request"],
    additionalProperties: false,
  };
}

export function inspectionSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      summary: { type: "string", minLength: 1, maxLength: 500 },
      count: { type: "integer", minimum: 0, maximum: 20 },
    },
    required: ["summary", "count"],
    additionalProperties: false,
  };
}

export function reportSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      report: { type: "string", minLength: 1, maxLength: 1_000 },
      approved: { type: "boolean" },
    },
    required: ["report", "approved"],
    additionalProperties: false,
  };
}

export function deterministicOutputSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      selected: { type: "string", minLength: 1, maxLength: 500 },
      meta: {
        type: "object",
        properties: {
          source: {
            type: "string",
            enum: ["deterministic"],
            minLength: 13,
            maxLength: 13,
          },
          flags: {
            type: "array",
            items: { type: "boolean" },
            minItems: 2,
            maxItems: 2,
          },
        },
        required: ["source", "flags"],
        additionalProperties: false,
      },
    },
    required: ["selected", "meta"],
    additionalProperties: false,
  };
}

export function listFilesReceiptSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      count: { type: "integer", minimum: 0 },
      truncated: { type: "boolean" },
      pathSha256: { type: "string", minLength: 64, maxLength: 64 },
      entrySetSha256: { type: "string", minLength: 64, maxLength: 64 },
    },
    required: ["count", "truncated", "pathSha256", "entrySetSha256"],
    additionalProperties: false,
  };
}

export function workflowNodes() {
  return [
    {
      id: "inspect",
      type: "agent" as const,
      inputBindings: {
        workflow: { source: "workflow" as const },
      },
      inputSchema: {
        type: "object" as const,
        properties: { workflow: requestSchema() },
        required: ["workflow"],
        additionalProperties: false as const,
      },
      outputSchema: inspectionSchema(),
      model: { provider: "faux-workflow", id: "faux-1" },
      timeoutMs: 5_000,
      maxAttempts: 2,
    },
    {
      id: "report",
      type: "agent" as const,
      inputBindings: {
        workflow: { source: "workflow" as const },
        inspection: { source: "node" as const, nodeId: "inspect" },
      },
      inputSchema: {
        type: "object" as const,
        properties: {
          workflow: requestSchema(),
          inspection: inspectionSchema(),
        },
        required: ["workflow", "inspection"],
        additionalProperties: false as const,
      },
      outputSchema: reportSchema(),
      model: { provider: "faux-workflow", id: "faux-1" },
      timeoutMs: 5_000,
      maxAttempts: 2,
    },
  ];
}

export async function createBlueprint(
  steps: CreateExecutionPlanRequest["steps"] = [
    {
      id: "inspect",
      title: "Inspect",
      description: "Inspect the workflow input.",
      verification: "Return typed inspection JSON.",
    },
    {
      id: "report",
      title: "Report",
      description: "Produce the final report from inspected evidence.",
      verification: "Return typed report JSON.",
      dependsOn: ["inspect"],
    },
  ],
  artifacts?: CreateExecutionPlanRequest["artifacts"],
): Promise<ExecutionPlanBlueprint> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-workflow-manifest-"));
  workflowManifestTemporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const thread = store.listThreads()[0]!;
  const plan = await store.createPlan(thread.id, {
    objective: "Create a typed report.",
    steps,
    ...(artifacts ? { artifacts } : {}),
  });
  const blueprint = await createExecutionPlanBlueprint(
    store,
    thread.id,
    plan.id,
  );
  store.close();
  return blueprint;
}
