import type {
  ExecutionPlanWorkflowPythonNode,
  JsonValue,
  RunEvent,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { MAX_PYTHON_KERNEL_TRACED_MEMORY_BYTES } from "./python-kernel-worker.js";
import { PYTHON_KERNEL_WORKER_SHA256 } from "./python-kernel-worker.js";
import {
  MAX_EXECUTION_PLAN_WORKFLOW_PYTHON_OUTPUT_BYTES,
  workflowPythonConfigurationSha256,
} from "./workflow-python-model.js";
import {
  parseExecutionPlanWorkflowNodeOutput,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

export const WORKFLOW_PYTHON_COMPLETED_EVENT = "workflow.python.completed";

export function hasWorkflowPythonCompletionEvent(
  events: RunEvent[],
  planId: string,
  nodeId: string,
  runId: string,
): boolean {
  return events.some(
    (event) =>
      event.runId === runId &&
      event.type === WORKFLOW_PYTHON_COMPLETED_EVENT &&
      record(event.payload)?.["planId"] === planId &&
      record(event.payload)?.["nodeId"] === nodeId,
  );
}

export function readWorkflowPythonOutputEvidence(options: {
  events: RunEvent[];
  node: ExecutionPlanWorkflowPythonNode;
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
      event.type === WORKFLOW_PYTHON_COMPLETED_EVENT &&
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
    payload["pythonConfigurationSha256"] !==
      workflowPythonConfigurationSha256(options.node) ||
    payload["workerSha256"] !== PYTHON_KERNEL_WORKER_SHA256 ||
    !hash(payload["runtimeExecutableSha256"]) ||
    !hash(payload["runtimeCommandSha256"]) ||
    typeof payload["pythonVersion"] !== "string" ||
    !/^\d+\.\d+\.\d+$/u.test(payload["pythonVersion"]) ||
    payload["inputSha256"] !== options.inputSha256 ||
    payload["cellCount"] !== options.node.cells.length ||
    !hash(payload["inputBindingRequestSha256"]) ||
    !hash(payload["inputBindingResultSha256"]) ||
    !hash(payload["cellRequestSetSha256"]) ||
    !hash(payload["cellResultSetSha256"]) ||
    !hash(payload["jsonValueSha256"]) ||
    !boundedInteger(
      payload["jsonValueBytes"],
      MAX_EXECUTION_PLAN_WORKFLOW_PYTHON_OUTPUT_BYTES,
    ) ||
    !hash(payload["outputSha256"]) ||
    !boundedInteger(
      payload["outputBytes"],
      MAX_EXECUTION_PLAN_WORKFLOW_PYTHON_OUTPUT_BYTES,
    ) ||
    !boundedInteger(payload["durationMs"], options.node.timeoutMs) ||
    !boundedInteger(
      payload["memoryPeakBytes"],
      MAX_PYTHON_KERNEL_TRACED_MEMORY_BYTES,
    ) ||
    payload["memoryLimitBytes"] !== MAX_PYTHON_KERNEL_TRACED_MEMORY_BYTES ||
    payload["output"] !== undefined ||
    payload["outputCanonicalSha256"] !== payload["outputSha256"] ||
    payload["outputSchemaSha256"] !==
      workflowSchemaSha256(options.node.outputSchema)
  ) {
    throw new Error("Workflow Python output evidence is unavailable");
  }
  const output = parseExecutionPlanWorkflowNodeOutput(
    options.assistantOutput,
    options.node.outputSchema,
  );
  const serializedOutput = canonicalJson(output);
  if (
    sha256(serializedOutput) !== payload["outputSha256"] ||
    payload["jsonValueSha256"] !== payload["outputSha256"] ||
    Buffer.byteLength(serializedOutput, "utf8") !== payload["outputBytes"] ||
    payload["jsonValueBytes"] !== payload["outputBytes"]
  ) {
    throw new Error("Workflow Python output evidence hash mismatch");
  }
  return output;
}

export function workflowPythonNodeMetadata(
  node: ExecutionPlanWorkflowPythonNode,
): Record<string, JsonValue> {
  return {
    nodeType: "python",
    pythonConfigurationSha256: workflowPythonConfigurationSha256(node),
  };
}

export function workflowPythonNodeMetadataMatches(
  node: ExecutionPlanWorkflowPythonNode,
  payload: Record<string, JsonValue>,
): boolean {
  return (
    payload["nodeType"] === "python" &&
    payload["pythonConfigurationSha256"] ===
      workflowPythonConfigurationSha256(node)
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedInteger(value: unknown, maximum: number): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= 0 &&
    Number(value) <= maximum
  );
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
