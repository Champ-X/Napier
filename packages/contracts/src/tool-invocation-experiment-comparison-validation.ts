import type {
  ToolInvocationExperimentComparison,
  ToolInvocationExperimentObservation,
} from "./execution-experiments.js";

import { canonical as canonicalJson, sha256 } from "./skill-load-validation.js";

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
const STATUSES = new Set(["completed", "failed", "cancelled"]);

export function validateToolInvocationExperimentComparison(
  input: unknown,
): ToolInvocationExperimentComparison {
  const value = record(input, "Tool invocation experiment comparison");
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "source",
    "target",
    "durationMsDelta",
    "outputChanged",
    "contentSha256",
  ]);
  const source = validateObservation(value["source"]);
  const target = validateObservation(value["target"]);
  if (
    value["kind"] !== "napier.tool-invocation-experiment-comparison" ||
    value["schemaVersion"] !== 1 ||
    !Number.isSafeInteger(value["durationMsDelta"]) ||
    value["durationMsDelta"] !== target.durationMs - source.durationMs ||
    typeof value["outputChanged"] !== "boolean" ||
    value["outputChanged"] !== (source.outputSha256 !== target.outputSha256) ||
    !hash(value["contentSha256"])
  ) {
    throw new Error("Tool invocation experiment comparison is invalid");
  }
  const content = {
    kind: value["kind"],
    schemaVersion: value["schemaVersion"],
    source,
    target,
    durationMsDelta: value["durationMsDelta"],
    outputChanged: value["outputChanged"],
  };
  if (sha256(canonicalJson(content)) !== value["contentSha256"]) {
    throw new Error("Tool invocation experiment comparison hash is invalid");
  }
  return {
    ...content,
    contentSha256: value["contentSha256"],
  } as ToolInvocationExperimentComparison;
}

function validateObservation(
  input: unknown,
): ToolInvocationExperimentObservation {
  const value = record(input, "Tool invocation experiment observation");
  exactKeys(value, [
    "threadId",
    "runId",
    "status",
    "toolName",
    "durationMs",
    "outputSha256",
    "outputBytes",
  ]);
  if (
    typeof value["threadId"] !== "string" ||
    !THREAD_ID.test(value["threadId"]) ||
    typeof value["runId"] !== "string" ||
    !RUN_ID.test(value["runId"]) ||
    typeof value["status"] !== "string" ||
    !STATUSES.has(value["status"]) ||
    typeof value["toolName"] !== "string" ||
    !TOOL_NAME.test(value["toolName"]) ||
    !nonNegativeInteger(value["durationMs"]) ||
    !hash(value["outputSha256"]) ||
    !nonNegativeInteger(value["outputBytes"]) ||
    value["outputBytes"] > 512 * 1024
  ) {
    throw new Error("Tool invocation experiment observation is invalid");
  }
  return structuredClone(
    value,
  ) as unknown as ToolInvocationExperimentObservation;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new Error("Tool invocation experiment fields are invalid");
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
