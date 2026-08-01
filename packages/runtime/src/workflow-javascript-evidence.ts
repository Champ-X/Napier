import type {
  ExecutionPlanWorkflowJavascriptNode,
  JsonValue,
  RunEvent,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { JAVASCRIPT_KERNEL_WORKER_SHA256 } from "./javascript-kernel-worker.js";
import { workflowJavascriptConfigurationSha256 } from "./workflow-javascript-model.js";
import {
  parseExecutionPlanWorkflowNodeOutput,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

export const WORKFLOW_JAVASCRIPT_COMPLETED_EVENT =
  "workflow.javascript.completed";

export function hasWorkflowJavascriptCompletionEvent(
  events: RunEvent[],
  planId: string,
  nodeId: string,
  runId: string,
): boolean {
  return events.some(
    (event) =>
      event.runId === runId &&
      event.type === WORKFLOW_JAVASCRIPT_COMPLETED_EVENT &&
      record(event.payload)?.["planId"] === planId &&
      record(event.payload)?.["nodeId"] === nodeId,
  );
}

export function readWorkflowJavascriptOutputEvidence(options: {
  events: RunEvent[];
  node: ExecutionPlanWorkflowJavascriptNode;
  runId: string;
  planId: string;
  manifestSha256: string;
  inputSha256: string;
  attempt: number;
  assistantOutput: string;
}): JsonValue {
  const completions = options.events.filter(
    (event) =>
      event.runId === options.runId &&
      event.type === WORKFLOW_JAVASCRIPT_COMPLETED_EVENT &&
      record(event.payload)?.["planId"] === options.planId &&
      record(event.payload)?.["nodeId"] === options.node.id,
  );
  const payload =
    completions.length === 1 ? record(completions[0]?.payload) : undefined;
  if (
    !payload ||
    payload["schemaVersion"] !== 1 ||
    payload["manifestSha256"] !== options.manifestSha256 ||
    payload["attempt"] !== options.attempt ||
    payload["javascriptConfigurationSha256"] !==
      workflowJavascriptConfigurationSha256(options.node) ||
    payload["workerSha256"] !== JAVASCRIPT_KERNEL_WORKER_SHA256 ||
    payload["inputSha256"] !== options.inputSha256 ||
    payload["cellCount"] !== options.node.cells.length ||
    !hash(payload["inputBindingRequestSha256"]) ||
    !hash(payload["inputBindingResultSha256"]) ||
    !hash(payload["cellRequestSetSha256"]) ||
    !hash(payload["cellResultSetSha256"]) ||
    !hash(payload["outputSha256"]) ||
    !nonNegativeInteger(payload["outputBytes"]) ||
    !nonNegativeInteger(payload["durationMs"]) ||
    payload["output"] !== undefined ||
    payload["outputSchemaSha256"] !==
      workflowSchemaSha256(options.node.outputSchema)
  ) {
    throw new Error("Workflow JavaScript output evidence is unavailable");
  }
  const output = parseExecutionPlanWorkflowNodeOutput(
    options.assistantOutput,
    options.node.outputSchema,
  );
  const serializedOutput = canonicalJson(output);
  if (
    sha256(serializedOutput) !== payload["outputSha256"] ||
    Buffer.byteLength(serializedOutput, "utf8") !== payload["outputBytes"]
  ) {
    throw new Error("Workflow JavaScript output evidence hash mismatch");
  }
  return output;
}

export function workflowJavascriptNodeMetadata(
  node: ExecutionPlanWorkflowJavascriptNode,
): Record<string, JsonValue> {
  return {
    nodeType: "javascript",
    javascriptConfigurationSha256: workflowJavascriptConfigurationSha256(node),
  };
}

export function workflowJavascriptNodeMetadataMatches(
  node: ExecutionPlanWorkflowJavascriptNode,
  payload: Record<string, JsonValue>,
): boolean {
  return (
    payload["nodeType"] === "javascript" &&
    payload["javascriptConfigurationSha256"] ===
      workflowJavascriptConfigurationSha256(node)
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
