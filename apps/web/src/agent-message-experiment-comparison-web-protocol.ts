import type {
  AgentMessageExperimentComparison,
  AgentMessageExperimentRunObservation,
  AgentMessageExperimentToolEffects,
  RunConfigurationDelta,
  RunMetricDelta,
  RunMetrics,
} from "@napier/contracts";

import { canonicalJson, sha256Text } from "./stable-digest";

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
const EXECUTION_MODES = new Set([
  "standard",
  "environment_degraded_read_only",
  "safe_read_only_recovery",
  "workflow_map_read_only",
  "workflow_loop_read_only",
  "agent_experiment_read_only",
]);
const METRIC_KEYS = [
  "durationMs",
  "eventCount",
  "messageCount",
  "modelResponseCount",
  "modelContextEnvelopeCount",
  "embeddedModelContextEnvelopeCount",
  "modelContextBoundResponseCount",
  "modelContextUnboundResponseCount",
  "toolCallCount",
  "toolCompletedCount",
  "toolFailedCount",
  "toolBlockedCount",
  "subagentCount",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "costUsd",
] as const;
const CONFIGURATION_FIELDS = new Set([
  "agentRevision",
  "model",
  "systemPrompt",
  "thinkingLevel",
  "toolPolicy",
  "enabledTools",
  "enabledSkills",
  "enabledSubagents",
  "subagentLimits",
  "runLimits",
  "automaticRecovery",
  "modelAdvisor",
  "executionMode",
  "skillCatalog",
  "promptVariables",
  "toolLoopGuard",
]);

export async function validateAgentMessageExperimentComparison(
  input: unknown,
): Promise<AgentMessageExperimentComparison> {
  const comparison = record(input, "Agent message experiment comparison");
  exactKeys(comparison, [
    "kind",
    "schemaVersion",
    "source",
    "target",
    "metricDelta",
    "outputChanged",
    "addedToolNames",
    "removedToolNames",
    "configurationDelta",
    "contentSha256",
  ]);
  const source = validateObservation(comparison["source"], "source");
  const target = validateObservation(comparison["target"], "target");
  const metricDelta = validateMetricDelta(comparison["metricDelta"]);
  const configurationDelta = validateConfigurationDelta(
    comparison["configurationDelta"],
  );
  const addedToolNames = validateNames(
    comparison["addedToolNames"],
    "addedToolNames",
  );
  const removedToolNames = validateNames(
    comparison["removedToolNames"],
    "removedToolNames",
  );
  if (
    comparison["kind"] !== "napier.agent-message-experiment-comparison" ||
    comparison["schemaVersion"] !== 1 ||
    typeof comparison["outputChanged"] !== "boolean" ||
    !hash(comparison["contentSha256"])
  ) {
    throw new Error("Agent message experiment comparison is invalid");
  }
  const expectedDelta = Object.fromEntries(
    METRIC_KEYS.map((key) => [key, target.metrics[key] - source.metrics[key]]),
  ) as unknown as RunMetricDelta;
  const sourceTools = new Set(source.toolNames);
  const targetTools = new Set(target.toolNames);
  if (
    canonicalJson(metricDelta) !== canonicalJson(expectedDelta) ||
    comparison["outputChanged"] !==
      (source.metrics.assistantTextSha256 !==
        target.metrics.assistantTextSha256) ||
    canonicalJson(addedToolNames) !==
      canonicalJson(
        target.toolNames.filter((name) => !sourceTools.has(name)),
      ) ||
    canonicalJson(removedToolNames) !==
      canonicalJson(source.toolNames.filter((name) => !targetTools.has(name)))
  ) {
    throw new Error(
      "Agent message experiment comparison projection is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = comparison;
  if (
    (await sha256Text(canonicalJson(content))) !== comparison["contentSha256"]
  ) {
    throw new Error("Agent message experiment comparison hash is invalid");
  }
  return {
    ...(structuredClone(
      comparison,
    ) as unknown as AgentMessageExperimentComparison),
    source,
    target,
    metricDelta,
    configurationDelta,
    addedToolNames,
    removedToolNames,
  };
}

export function validateAgentMessageExperimentToolEffects(
  input: unknown,
): AgentMessageExperimentToolEffects {
  const effects = record(input, "Agent message experiment tool effects");
  exactKeys(effects, [
    "toolCallCount",
    "readOnlyCount",
    "writeCount",
    "unknownCount",
    "unresolvedCount",
    "writeToolNames",
    "unknownToolNames",
  ]);
  const toolCallCount = nonNegativeInteger(effects["toolCallCount"]);
  const readOnlyCount = nonNegativeInteger(effects["readOnlyCount"]);
  const writeCount = nonNegativeInteger(effects["writeCount"]);
  const unknownCount = nonNegativeInteger(effects["unknownCount"]);
  const unresolvedCount = nonNegativeInteger(effects["unresolvedCount"]);
  const writeToolNames = validateNames(
    effects["writeToolNames"],
    "writeToolNames",
  );
  const unknownToolNames = validateNames(
    effects["unknownToolNames"],
    "unknownToolNames",
  );
  if (
    toolCallCount === undefined ||
    readOnlyCount === undefined ||
    writeCount === undefined ||
    unknownCount === undefined ||
    unresolvedCount === undefined ||
    toolCallCount !== readOnlyCount + writeCount + unknownCount ||
    unresolvedCount > toolCallCount
  ) {
    throw new Error("Agent message experiment tool effects are invalid");
  }
  return {
    toolCallCount,
    readOnlyCount,
    writeCount,
    unknownCount,
    unresolvedCount,
    writeToolNames,
    unknownToolNames,
  };
}

export function validateAgentMessageExperimentNames(
  input: unknown,
  label: string,
): string[] {
  return validateNames(input, label);
}

function validateObservation(
  input: unknown,
  label: string,
): AgentMessageExperimentRunObservation {
  const observation = record(input, `Agent message experiment ${label}`);
  exactKeys(observation, [
    "threadId",
    "runId",
    "status",
    "configurationSha256",
    "model",
    "executionMode",
    "metrics",
    "toolNames",
    "toolEffects",
  ]);
  const model = validateModel(observation["model"], `${label} model`);
  const metrics = validateMetrics(observation["metrics"]);
  const toolNames = validateNames(
    observation["toolNames"],
    `${label} toolNames`,
  );
  const toolEffects = validateAgentMessageExperimentToolEffects(
    observation["toolEffects"],
  );
  if (
    typeof observation["threadId"] !== "string" ||
    !THREAD_ID.test(observation["threadId"]) ||
    typeof observation["runId"] !== "string" ||
    !RUN_ID.test(observation["runId"]) ||
    !TERMINAL_STATUSES.has(String(observation["status"])) ||
    !hash(observation["configurationSha256"]) ||
    !EXECUTION_MODES.has(String(observation["executionMode"]))
  ) {
    throw new Error(`Agent message experiment ${label} is invalid`);
  }
  return {
    ...(structuredClone(
      observation,
    ) as unknown as AgentMessageExperimentRunObservation),
    model,
    metrics,
    toolNames,
    toolEffects,
  };
}

function validateMetrics(input: unknown): RunMetrics {
  const metrics = record(input, "Agent message experiment metrics");
  exactKeys(metrics, [...METRIC_KEYS, "assistantTextSha256"]);
  if (
    METRIC_KEYS.some(
      (key) =>
        typeof metrics[key] !== "number" ||
        !Number.isFinite(metrics[key]) ||
        metrics[key] < 0 ||
        (key !== "costUsd" && !Number.isSafeInteger(metrics[key])),
    ) ||
    !hash(metrics["assistantTextSha256"])
  ) {
    throw new Error("Agent message experiment metrics are invalid");
  }
  return structuredClone(metrics) as unknown as RunMetrics;
}

function validateMetricDelta(input: unknown): RunMetricDelta {
  const metrics = record(input, "Agent message experiment metric delta");
  exactKeys(metrics, [...METRIC_KEYS]);
  if (
    METRIC_KEYS.some(
      (key) =>
        typeof metrics[key] !== "number" ||
        !Number.isFinite(metrics[key]) ||
        (key !== "costUsd" && !Number.isSafeInteger(metrics[key])),
    )
  ) {
    throw new Error("Agent message experiment metric delta is invalid");
  }
  return structuredClone(metrics) as unknown as RunMetricDelta;
}

function validateConfigurationDelta(input: unknown): RunConfigurationDelta {
  const delta = record(input, "Agent message experiment configuration delta");
  const optional =
    delta["status"] === "unavailable"
      ? new Set(["leftSha256", "rightSha256"])
      : new Set<string>();
  exactKeys(
    delta,
    [
      "status",
      "leftSha256",
      "rightSha256",
      "changedFields",
      "addedTools",
      "removedTools",
      "addedSkills",
      "removedSkills",
      "addedSubagents",
      "removedSubagents",
    ],
    optional,
  );
  const changedFields = delta["changedFields"];
  if (
    (delta["status"] !== "comparable" && delta["status"] !== "unavailable") ||
    (delta["leftSha256"] !== undefined && !hash(delta["leftSha256"])) ||
    (delta["rightSha256"] !== undefined && !hash(delta["rightSha256"])) ||
    !Array.isArray(changedFields) ||
    changedFields.length > CONFIGURATION_FIELDS.size ||
    changedFields.some(
      (field) => typeof field !== "string" || !CONFIGURATION_FIELDS.has(field),
    ) ||
    new Set(changedFields).size !== changedFields.length
  ) {
    throw new Error("Agent message experiment configuration delta is invalid");
  }
  for (const key of [
    "addedTools",
    "removedTools",
    "addedSkills",
    "removedSkills",
    "addedSubagents",
    "removedSubagents",
  ]) {
    validateNames(delta[key], key);
  }
  return structuredClone(delta) as unknown as RunConfigurationDelta;
}

function validateNames(input: unknown, label: string): string[] {
  if (
    !Array.isArray(input) ||
    input.length > 128 ||
    input.some((name) => typeof name !== "string" || !TOOL_NAME.test(name))
  ) {
    throw new Error(`Agent message experiment ${label} is invalid`);
  }
  const canonical = [...new Set(input)].sort((left, right) =>
    left.localeCompare(right),
  );
  if (canonicalJson(input) !== canonicalJson(canonical)) {
    throw new Error(`Agent message experiment ${label} is invalid`);
  }
  return [...input] as string[];
}

function validateModel(input: unknown, label: string) {
  const model = record(input, label);
  exactKeys(model, ["provider", "id"]);
  if (
    typeof model["provider"] !== "string" ||
    !PROVIDER_ID.test(model["provider"]) ||
    typeof model["id"] !== "string" ||
    !MODEL_ID.test(model["id"])
  ) {
    throw new Error(`${label} is invalid`);
  }
  return { provider: model["provider"], id: model["id"] };
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: ReadonlySet<string> = new Set(),
): void {
  const allowed = new Set(required);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    required.some((key) => !optional.has(key) && !Object.hasOwn(value, key))
  ) {
    throw new Error("Agent message experiment fields are invalid");
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

function nonNegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}
