import type {
  ExecutionPlanWorkflowReduceNode,
  RunEvent,
  WorkflowValueSchema,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  readWorkflowReduceOutputEvidence,
  workflowReduceNodeMetadataMatches,
} from "../src/workflow-reduce-evidence.js";
import {
  executeWorkflowReduce,
  WorkflowReduceComputationError,
  workflowReduceConfigurationSha256,
  workflowReduceItemSetSha256,
  workflowReduceProjection,
  workflowReduceValueSetSha256,
} from "../src/workflow-reduce-model.js";
import { workflowSchemaSha256 } from "../src/workflow-schemas.js";

describe("Workflow Reduce model", () => {
  it("reduces bounded primitive and field values with deterministic identities", () => {
    expect(
      reduce(reduceNode("count", { type: "integer" }), { items: [] }),
    ).toBe(0);
    expect(
      reduce(reduceNode("sum", { type: "integer" }, ["score"]), {
        items: [{ score: 2 }, { score: 3 }, { score: -1 }],
      }),
    ).toBe(4);
    expect(
      reduce(reduceNode("minimum", { type: "number" }), {
        items: [3.5, -2, 8],
      }),
    ).toBe(-2);
    expect(
      reduce(reduceNode("maximum", { type: "number" }), {
        items: [3.5, -2, 8],
      }),
    ).toBe(8);
    expect(
      reduce(reduceNode("minimum", { type: "number" }), {
        items: [-0, 0],
      }),
    ).toBe(0);
    expect(
      reduce(reduceNode("maximum", { type: "number" }), {
        items: [-0],
      }),
    ).toBe(0);
    expect(reduce(reduceNode("all", { type: "boolean" }), { items: [] })).toBe(
      true,
    );
    expect(
      reduce(reduceNode("any", { type: "boolean" }, ["accepted"]), {
        items: [{ accepted: false }, { accepted: true }],
      }),
    ).toBe(true);
  });

  it("fails closed on unavailable values, empty extrema, and unsafe arithmetic", () => {
    expect(() =>
      reduce(reduceNode("sum", { type: "integer" }, ["score"]), {
        items: [{ score: 1 }, { missing: 2 }],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkflowReduceComputationError>>({
        code: "value_invalid",
      }),
    );
    expect(() =>
      reduce(reduceNode("minimum", { type: "integer" }), { items: [] }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkflowReduceComputationError>>({
        code: "empty_extrema",
      }),
    );
    expect(() =>
      reduce(reduceNode("sum", { type: "integer" }), {
        items: [Number.MAX_SAFE_INTEGER, 1],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkflowReduceComputationError>>({
        code: "arithmetic_overflow",
      }),
    );
    expect(() =>
      reduce(reduceNode("all", { type: "boolean" }), { items: [true, 1] }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkflowReduceComputationError>>({
        code: "value_invalid",
      }),
    );
  });

  it("binds operation and paths into the Reduce configuration", () => {
    const sum = reduceNode("sum", { type: "integer" }, ["score"]);
    expect(workflowReduceConfigurationSha256(sum)).toMatch(/^[a-f0-9]{64}$/u);
    expect(workflowReduceConfigurationSha256(sum)).not.toBe(
      workflowReduceConfigurationSha256({
        ...sum,
        operation: "maximum",
      }),
    );
    expect(workflowReduceConfigurationSha256(sum)).not.toBe(
      workflowReduceConfigurationSha256({
        ...sum,
        valuePath: ["other"],
      }),
    );
  });

  it("requires one complete configuration-bound recovery receipt", () => {
    const node = reduceNode("sum", { type: "integer" }, ["score"]);
    const input = { items: [{ score: 2 }, { score: 3 }] };
    const projection = workflowReduceProjection(node, input);
    const output = 5;
    const outputText = canonicalJson(output);
    const completion: RunEvent = {
      id: "event_reduce_completion",
      threadId: "thread_reduce_evidence",
      runId: "run_reduce_evidence",
      seq: 1,
      type: "workflow.reduce.completed",
      category: "plan",
      visibility: "user",
      createdAt: "2026-07-31T00:00:00.000Z",
      payload: {
        schemaVersion: 1,
        planId: "plan_reduce_evidence",
        nodeId: node.id,
        attempt: 1,
        manifestSha256: "a".repeat(64),
        operation: node.operation,
        reduceConfigurationSha256: workflowReduceConfigurationSha256(node),
        inputSha256: "b".repeat(64),
        itemCount: projection.items.length,
        itemSetSha256: workflowReduceItemSetSha256(projection),
        valueSetSha256: workflowReduceValueSetSha256(projection),
        outputSha256: sha256(outputText),
        outputBytes: Buffer.byteLength(outputText, "utf8"),
        outputSchemaSha256: workflowSchemaSha256(node.outputSchema),
      },
    };
    const options = {
      events: [completion],
      node,
      runId: completion.runId,
      planId: "plan_reduce_evidence",
      manifestSha256: "a".repeat(64),
      input,
      inputSha256: "b".repeat(64),
      attempt: 1,
      assistantOutput: outputText,
    };

    expect(readWorkflowReduceOutputEvidence(options)).toBe(5);
    expect(
      workflowReduceNodeMetadataMatches(node, {
        nodeType: "reduce",
        reduceConfigurationSha256: workflowReduceConfigurationSha256(node),
      }),
    ).toBe(true);
    expect(() =>
      readWorkflowReduceOutputEvidence({
        ...options,
        events: [completion, structuredClone(completion)],
      }),
    ).toThrow("unavailable");
    expect(() =>
      readWorkflowReduceOutputEvidence({
        ...options,
        events: [
          {
            ...completion,
            payload: {
              ...(completion.payload as Record<string, unknown>),
              valueSetSha256: "c".repeat(64),
            },
          },
        ],
      }),
    ).toThrow("unavailable");
    const wrongOutputText = canonicalJson(6);
    expect(() =>
      readWorkflowReduceOutputEvidence({
        ...options,
        assistantOutput: wrongOutputText,
        events: [
          {
            ...completion,
            payload: {
              ...(completion.payload as Record<string, unknown>),
              outputSha256: sha256(wrongOutputText),
              outputBytes: Buffer.byteLength(wrongOutputText, "utf8"),
            },
          },
        ],
      }),
    ).toThrow("unavailable");
    expect(() =>
      readWorkflowReduceOutputEvidence({
        ...options,
        events: [
          {
            ...completion,
            payload: {
              ...(completion.payload as Record<string, unknown>),
              output,
            },
          },
        ],
      }),
    ).toThrow("unavailable");
    expect(() =>
      readWorkflowReduceOutputEvidence({
        ...options,
        events: [
          {
            ...completion,
            payload: {
              ...(completion.payload as Record<string, unknown>),
              values: [2, 3],
            },
          },
        ],
      }),
    ).toThrow("unavailable");
  });
});

function reduce(
  node: ExecutionPlanWorkflowReduceNode,
  input: { items: unknown[] },
) {
  return executeWorkflowReduce(
    node,
    workflowReduceProjection(node, input as never),
  );
}

function reduceNode(
  operation: ExecutionPlanWorkflowReduceNode["operation"],
  outputSchema: WorkflowValueSchema,
  valuePath?: string[],
): ExecutionPlanWorkflowReduceNode {
  return {
    id: "reduce",
    type: "reduce",
    inputBindings: {
      items: { source: "workflow", path: ["items"] },
    },
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "integer" },
          minItems: 0,
          maxItems: 16,
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
    outputSchema,
    itemsPath: ["items"],
    ...(valuePath ? { valuePath } : {}),
    operation,
    timeoutMs: 5_000,
    maxAttempts: 2,
  };
}
