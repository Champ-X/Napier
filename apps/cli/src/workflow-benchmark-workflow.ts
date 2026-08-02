import type {
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowMapNode,
  ExecutionPlanWorkflowReduceNode,
  ModelRef,
} from "@napier/contracts";
import {
  createExecutionPlanBlueprint,
  defineExecutionPlanWorkflow,
  type LocalStore,
} from "@napier/runtime";

import type {
  WorkflowBenchmarkCase,
  WorkflowBenchmarkInput,
} from "./workflow-benchmark-types.js";

export async function createWorkflowBenchmarkManifest(input: {
  store: LocalStore;
  benchmarkCase: WorkflowBenchmarkCase;
  benchmarkInput: WorkflowBenchmarkInput;
  model: ModelRef;
}): Promise<ExecutionPlanWorkflowManifest> {
  const sourceThread = input.store.listThreads()[0];
  if (!sourceThread) {
    throw new Error("Workflow benchmark source Thread is unavailable");
  }
  const sourcePlan = await input.store.createPlan(sourceThread.id, {
    objective: input.benchmarkCase.objective,
    steps: [
      {
        id: "extract",
        title: "Extract document length",
        description:
          "For each document, return strict JSON containing its exact id and ASCII character count.",
        verification:
          "Every result contains only id and length and satisfies the declared schema.",
      },
      {
        id: "total_length",
        title: "Total document lengths",
        description:
          "Deterministically sum the typed length from every Map result.",
        verification: "The output equals the sum of every extracted length.",
        dependsOn: ["extract"],
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    input.store,
    sourceThread.id,
    sourcePlan.id,
  );
  const documentSchema = {
    type: "object" as const,
    properties: {
      id: { type: "string" as const, minLength: 3, maxLength: 40 },
      text: { type: "string" as const, minLength: 1, maxLength: 200 },
    },
    required: ["id", "text"],
    additionalProperties: false as const,
  };
  const resultSchema = {
    type: "object" as const,
    properties: {
      id: { type: "string" as const, minLength: 3, maxLength: 40 },
      length: { type: "integer" as const, minimum: 1, maximum: 200 },
    },
    required: ["id", "length"],
    additionalProperties: false as const,
  };
  const mapOutputSchema = {
    type: "array" as const,
    items: resultSchema,
    minItems: input.benchmarkInput.documents.length,
    maxItems: input.benchmarkInput.documents.length,
  };
  const mapNode: ExecutionPlanWorkflowMapNode = {
    id: "extract",
    type: "map",
    inputBindings: {
      documents: { source: "workflow", path: ["documents"] },
    },
    inputSchema: {
      type: "object",
      properties: {
        documents: {
          type: "array",
          items: documentSchema,
          minItems: input.benchmarkInput.documents.length,
          maxItems: input.benchmarkInput.documents.length,
        },
      },
      required: ["documents"],
      additionalProperties: false,
    },
    outputSchema: mapOutputSchema,
    itemsPath: ["documents"],
    model: structuredClone(input.model),
    maxConcurrency: Math.min(4, input.benchmarkInput.documents.length),
    itemTimeoutMs: Math.min(60_000, input.benchmarkCase.timeoutMs),
    timeoutMs: input.benchmarkCase.timeoutMs,
    maxAttempts: 1,
  };
  const reduceNode: ExecutionPlanWorkflowReduceNode = {
    id: "total_length",
    type: "reduce",
    inputBindings: {
      items: { source: "node", nodeId: "extract" },
    },
    inputSchema: {
      type: "object",
      properties: { items: mapOutputSchema },
      required: ["items"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "integer",
      minimum: input.benchmarkInput.documents.length,
      maximum: input.benchmarkInput.documents.length * 200,
    },
    itemsPath: ["items"],
    valuePath: ["length"],
    operation: "sum",
    timeoutMs: 5_000,
    maxAttempts: 1,
  };
  return defineExecutionPlanWorkflow({
    name: input.benchmarkCase.title,
    version: 1,
    description:
      "Fixed typed Agent Map and deterministic Reduce outcome benchmark.",
    blueprint,
    inputSchema: {
      type: "object",
      properties: {
        documents: {
          type: "array",
          items: documentSchema,
          minItems: input.benchmarkInput.documents.length,
          maxItems: input.benchmarkInput.documents.length,
        },
      },
      required: ["documents"],
      additionalProperties: false,
    },
    outputSchema: reduceNode.outputSchema,
    outputNodeId: "total_length",
    nodes: [mapNode, reduceNode],
    maxConcurrency: 4,
  });
}
