import type {
  ExecutionPlanWorkflowDeterministicNode,
  JsonValue,
  RunEvent,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { executionPlanWorkflowDeterministicTemplateSha256 } from "./workflow-deterministic-model.js";
import {
  parseExecutionPlanWorkflowNodeOutput,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

export const WORKFLOW_DETERMINISTIC_COMPLETED_EVENT =
  "workflow.deterministic.completed";

export function hasWorkflowDeterministicCompletionEvent(
  events: RunEvent[],
  planId: string,
  nodeId: string,
  runId: string,
): boolean {
  return events.some(
    (event) =>
      event.runId === runId &&
      event.type === WORKFLOW_DETERMINISTIC_COMPLETED_EVENT &&
      record(event.payload)?.["planId"] === planId &&
      record(event.payload)?.["nodeId"] === nodeId,
  );
}

export function readWorkflowDeterministicOutputEvidence(options: {
  events: RunEvent[];
  node: ExecutionPlanWorkflowDeterministicNode;
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
      event.type === WORKFLOW_DETERMINISTIC_COMPLETED_EVENT &&
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
    payload["templateSha256"] !==
      executionPlanWorkflowDeterministicTemplateSha256(options.node.template) ||
    payload["inputSha256"] !== options.inputSha256 ||
    !hash(payload["outputSha256"]) ||
    !nonNegativeInteger(payload["outputBytes"]) ||
    payload["output"] !== undefined ||
    payload["outputSchemaSha256"] !==
      workflowSchemaSha256(options.node.outputSchema)
  ) {
    throw new Error("Workflow deterministic output evidence is unavailable");
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
    throw new Error("Workflow deterministic output evidence hash mismatch");
  }
  return output;
}

export function workflowDeterministicNodeMetadata(
  node: ExecutionPlanWorkflowDeterministicNode,
): Record<string, JsonValue> {
  return {
    nodeType: "deterministic",
    templateSha256: executionPlanWorkflowDeterministicTemplateSha256(
      node.template,
    ),
  };
}

export function workflowDeterministicNodeMetadataMatches(
  node: ExecutionPlanWorkflowDeterministicNode,
  payload: Record<string, JsonValue>,
): boolean {
  return (
    payload["nodeType"] === "deterministic" &&
    payload["templateSha256"] ===
      executionPlanWorkflowDeterministicTemplateSha256(node.template)
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
