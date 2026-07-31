import type {
  ExecutionPlanWorkflowReduceNode,
  JsonValue,
  RunEvent,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  executeWorkflowReduce,
  workflowReduceConfigurationSha256,
  workflowReduceItemSetSha256,
  workflowReduceProjection,
  workflowReduceValueSetSha256,
} from "./workflow-reduce-model.js";
import {
  parseExecutionPlanWorkflowNodeOutput,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

export const WORKFLOW_REDUCE_COMPLETED_EVENT = "workflow.reduce.completed";

const WORKFLOW_REDUCE_COMPLETION_KEYS = new Set([
  "schemaVersion",
  "planId",
  "nodeId",
  "attempt",
  "manifestSha256",
  "operation",
  "reduceConfigurationSha256",
  "inputSha256",
  "itemCount",
  "itemSetSha256",
  "valueSetSha256",
  "outputSha256",
  "outputBytes",
  "outputSchemaSha256",
]);

export function hasWorkflowReduceCompletionEvent(
  events: RunEvent[],
  planId: string,
  nodeId: string,
  runId: string,
): boolean {
  return events.some(
    (event) =>
      event.runId === runId &&
      event.type === WORKFLOW_REDUCE_COMPLETED_EVENT &&
      record(event.payload)?.["planId"] === planId &&
      record(event.payload)?.["nodeId"] === nodeId,
  );
}

export function readWorkflowReduceOutputEvidence(options: {
  events: RunEvent[];
  node: ExecutionPlanWorkflowReduceNode;
  runId: string;
  planId: string;
  manifestSha256: string;
  input: JsonValue;
  inputSha256: string;
  attempt: number;
  assistantOutput: string;
}): JsonValue {
  const completions = options.events.filter(
    (event) =>
      event.runId === options.runId &&
      event.type === WORKFLOW_REDUCE_COMPLETED_EVENT &&
      record(event.payload)?.["planId"] === options.planId &&
      record(event.payload)?.["nodeId"] === options.node.id,
  );
  const payload =
    completions.length === 1 ? record(completions[0]?.payload) : undefined;
  const projection = workflowReduceProjection(options.node, options.input);
  const output = parseExecutionPlanWorkflowNodeOutput(
    options.assistantOutput,
    options.node.outputSchema,
  );
  const expectedOutput = executeWorkflowReduce(options.node, projection);
  const serializedOutput = canonicalJson(output);
  if (
    !payload ||
    !hasExactCompletionKeys(payload) ||
    payload["schemaVersion"] !== 1 ||
    payload["manifestSha256"] !== options.manifestSha256 ||
    payload["attempt"] !== options.attempt ||
    payload["operation"] !== options.node.operation ||
    payload["reduceConfigurationSha256"] !==
      workflowReduceConfigurationSha256(options.node) ||
    payload["inputSha256"] !== options.inputSha256 ||
    payload["itemCount"] !== projection.items.length ||
    payload["itemSetSha256"] !== workflowReduceItemSetSha256(projection) ||
    payload["valueSetSha256"] !== workflowReduceValueSetSha256(projection) ||
    payload["outputSha256"] !== sha256(serializedOutput) ||
    payload["outputBytes"] !== Buffer.byteLength(serializedOutput, "utf8") ||
    payload["outputSchemaSha256"] !==
      workflowSchemaSha256(options.node.outputSchema) ||
    canonicalJson(output) !== canonicalJson(expectedOutput)
  ) {
    throw new Error("Workflow Reduce output evidence is unavailable");
  }
  return output;
}

export function workflowReduceNodeMetadata(
  node: ExecutionPlanWorkflowReduceNode,
): Record<string, JsonValue> {
  return {
    nodeType: "reduce",
    reduceConfigurationSha256: workflowReduceConfigurationSha256(node),
  };
}

export function workflowReduceNodeMetadataMatches(
  node: ExecutionPlanWorkflowReduceNode,
  payload: Record<string, JsonValue>,
): boolean {
  return (
    payload["nodeType"] === "reduce" &&
    payload["reduceConfigurationSha256"] ===
      workflowReduceConfigurationSha256(node)
  );
}

function record(value: unknown): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined;
}

function hasExactCompletionKeys(payload: Record<string, JsonValue>): boolean {
  const keys = Object.keys(payload);
  return (
    keys.length === WORKFLOW_REDUCE_COMPLETION_KEYS.size &&
    keys.every((key) => WORKFLOW_REDUCE_COMPLETION_KEYS.has(key))
  );
}
