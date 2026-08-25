import type { ModelRef, Usage } from "./execution-core.js";
import type {
  ModelInvocationExperimentComparison,
  ModelInvocationExperimentMetricDelta,
  ModelInvocationExperimentObservation,
} from "./execution-experiments.js";

import { canonical as canonicalJson, sha256 } from "./skill-load-validation.js";

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
const STATUSES = new Set(["completed", "failed", "cancelled"]);
const STOP_REASONS = new Set(["stop", "length", "toolUse", "error", "aborted"]);

export function validateModelInvocationExperimentComparison(
  input: unknown,
): ModelInvocationExperimentComparison {
  const value = record(input, "Model invocation experiment comparison");
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "source",
    "target",
    "metricDelta",
    "outputChanged",
    "textChanged",
    "addedToolNames",
    "removedToolNames",
    "contentSha256",
  ]);
  const source = validateObservation(value["source"]);
  const target = validateObservation(value["target"]);
  const metricDelta = validateMetricDelta(value["metricDelta"]);
  const addedToolNames = validateNames(value["addedToolNames"]);
  const removedToolNames = validateNames(value["removedToolNames"]);
  const expectedDelta = {
    durationMs: target.durationMs - source.durationMs,
    inputTokens: target.usage.inputTokens - source.usage.inputTokens,
    outputTokens: target.usage.outputTokens - source.usage.outputTokens,
    cacheReadTokens:
      target.usage.cacheReadTokens - source.usage.cacheReadTokens,
    cacheWriteTokens:
      target.usage.cacheWriteTokens - source.usage.cacheWriteTokens,
    costUsd: target.usage.costUsd - source.usage.costUsd,
    toolCallCount: target.toolCallCount - source.toolCallCount,
  };
  const sourceTools = new Set(source.toolNames);
  const targetTools = new Set(target.toolNames);
  if (
    value["kind"] !== "napier.model-invocation-experiment-comparison" ||
    value["schemaVersion"] !== 1 ||
    typeof value["outputChanged"] !== "boolean" ||
    typeof value["textChanged"] !== "boolean" ||
    !hash(value["contentSha256"]) ||
    canonicalJson(metricDelta) !== canonicalJson(expectedDelta) ||
    value["outputChanged"] !== (source.outputSha256 !== target.outputSha256) ||
    value["textChanged"] !== (source.textSha256 !== target.textSha256) ||
    canonicalJson(addedToolNames) !==
      canonicalJson(
        target.toolNames.filter((name) => !sourceTools.has(name)),
      ) ||
    canonicalJson(removedToolNames) !==
      canonicalJson(source.toolNames.filter((name) => !targetTools.has(name)))
  ) {
    throw new Error("Model invocation experiment comparison is invalid");
  }
  const content = {
    kind: value["kind"],
    schemaVersion: value["schemaVersion"],
    source,
    target,
    metricDelta,
    outputChanged: value["outputChanged"],
    textChanged: value["textChanged"],
    addedToolNames,
    removedToolNames,
  };
  if (sha256(canonicalJson(content)) !== value["contentSha256"]) {
    throw new Error("Model invocation experiment comparison hash is invalid");
  }
  return {
    ...content,
    contentSha256: value["contentSha256"],
  } as ModelInvocationExperimentComparison;
}

export function validateModelInvocationExperimentObservation(
  input: unknown,
): ModelInvocationExperimentObservation {
  return validateObservation(input);
}

export function validateModelInvocationExperimentNames(
  input: unknown,
): string[] {
  return validateNames(input);
}

function validateObservation(
  input: unknown,
): ModelInvocationExperimentObservation {
  const value = record(input, "Model invocation experiment observation");
  exactKeys(value, [
    "threadId",
    "runId",
    "status",
    "model",
    "stopReason",
    "durationMs",
    "usage",
    "textSha256",
    "outputSha256",
    "toolCallCount",
    "toolNames",
  ]);
  const model = validateModel(value["model"]);
  const usage = validateUsage(value["usage"]);
  const toolNames = validateNames(value["toolNames"]);
  if (
    typeof value["threadId"] !== "string" ||
    !THREAD_ID.test(value["threadId"]) ||
    typeof value["runId"] !== "string" ||
    !RUN_ID.test(value["runId"]) ||
    typeof value["status"] !== "string" ||
    !STATUSES.has(value["status"]) ||
    typeof value["stopReason"] !== "string" ||
    !STOP_REASONS.has(value["stopReason"]) ||
    value["status"] !== statusFromStopReason(value["stopReason"]) ||
    !nonNegativeInteger(value["durationMs"]) ||
    !hash(value["textSha256"]) ||
    !hash(value["outputSha256"]) ||
    !nonNegativeInteger(value["toolCallCount"]) ||
    value["toolCallCount"] < toolNames.length
  ) {
    throw new Error("Model invocation experiment observation is invalid");
  }
  return {
    threadId: value["threadId"],
    runId: value["runId"],
    status: value["status"],
    model,
    stopReason: value["stopReason"],
    durationMs: value["durationMs"],
    usage,
    textSha256: value["textSha256"],
    outputSha256: value["outputSha256"],
    toolCallCount: value["toolCallCount"],
    toolNames,
  } as ModelInvocationExperimentObservation;
}

function validateMetricDelta(
  input: unknown,
): ModelInvocationExperimentMetricDelta {
  const value = record(input, "Model invocation experiment metric delta");
  exactKeys(value, [
    "durationMs",
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "costUsd",
    "toolCallCount",
  ]);
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item !== "number" ||
      !Number.isFinite(item) ||
      (key !== "costUsd" && !Number.isSafeInteger(item))
    ) {
      throw new Error("Model invocation experiment metric delta is invalid");
    }
  }
  return structuredClone(
    value,
  ) as unknown as ModelInvocationExperimentMetricDelta;
}

function validateUsage(input: unknown): Usage {
  const value = record(input, "Model invocation experiment usage");
  exactKeys(value, [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "costUsd",
  ]);
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item !== "number" ||
      !Number.isFinite(item) ||
      item < 0 ||
      (key !== "costUsd" && !Number.isSafeInteger(item))
    ) {
      throw new Error("Model invocation experiment usage is invalid");
    }
  }
  return structuredClone(value) as unknown as Usage;
}

function validateNames(input: unknown): string[] {
  if (
    !Array.isArray(input) ||
    input.length > 256 ||
    input.some((name) => typeof name !== "string" || !TOOL_NAME.test(name))
  ) {
    throw new Error("Model invocation experiment tool names are invalid");
  }
  const canonical = [...new Set(input)].sort((left, right) =>
    left.localeCompare(right),
  );
  if (canonicalJson(input) !== canonicalJson(canonical)) {
    throw new Error("Model invocation experiment tool names are invalid");
  }
  return [...input];
}

function validateModel(input: unknown): ModelRef {
  const value = record(input, "Model invocation experiment model");
  exactKeys(value, ["provider", "id"]);
  if (
    typeof value["provider"] !== "string" ||
    !PROVIDER_ID.test(value["provider"]) ||
    typeof value["id"] !== "string" ||
    !MODEL_ID.test(value["id"])
  ) {
    throw new Error("Model invocation experiment model is invalid");
  }
  return { provider: value["provider"], id: value["id"] };
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new Error("Model invocation experiment fields are invalid");
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function statusFromStopReason(
  stopReason: string,
): ModelInvocationExperimentObservation["status"] {
  if (stopReason === "error") return "failed";
  if (stopReason === "aborted") return "cancelled";
  return "completed";
}
