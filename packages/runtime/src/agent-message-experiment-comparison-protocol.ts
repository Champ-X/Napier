import type {
  AgentMessageExperimentComparison,
  AgentMessageExperimentRunObservation,
  AgentMessageExperimentToolEffects,
  ModelRef,
  RunConfigurationDelta,
  RunExecutionMode,
  RunMetricDelta,
  RunMetrics,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { agentMessageExperimentMetricDeltaIsFinite } from "./agent-message-experiment-model.js";

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
const EXECUTION_MODES = new Set<RunExecutionMode>([
  "standard",
  "safe_read_only_recovery",
  "workflow_map_read_only",
  "workflow_loop_read_only",
  "agent_experiment_read_only",
]);
const RUN_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
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
const CONFIGURATION_DELTA_KEYS = [
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
];
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

export function validateAgentMessageExperimentComparison(
  input: unknown,
): AgentMessageExperimentComparison {
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
  if (
    comparison["kind"] !== "napier.agent-message-experiment-comparison" ||
    comparison["schemaVersion"] !== 1 ||
    typeof comparison["outputChanged"] !== "boolean" ||
    typeof comparison["contentSha256"] !== "string" ||
    !HASH.test(comparison["contentSha256"])
  ) {
    throw new Error("Agent message experiment comparison is invalid");
  }
  validateAgentMessageExperimentNames(
    comparison["addedToolNames"],
    "addedToolNames",
  );
  validateAgentMessageExperimentNames(
    comparison["removedToolNames"],
    "removedToolNames",
  );
  const { contentSha256: _contentSha256, ...content } = comparison;
  if (sha256(canonicalJson(content)) !== comparison["contentSha256"]) {
    throw new Error("Agent message experiment comparison hash mismatch");
  }
  return {
    ...(structuredClone(
      comparison,
    ) as unknown as AgentMessageExperimentComparison),
    source,
    target,
    metricDelta,
    configurationDelta,
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
  const counts = [
    effects["toolCallCount"],
    effects["readOnlyCount"],
    effects["writeCount"],
    effects["unknownCount"],
    effects["unresolvedCount"],
  ];
  if (
    counts.some((count) => !nonNegativeInteger(count)) ||
    Number(effects["toolCallCount"]) !==
      Number(effects["readOnlyCount"]) +
        Number(effects["writeCount"]) +
        Number(effects["unknownCount"]) ||
    Number(effects["unresolvedCount"]) > Number(effects["toolCallCount"])
  ) {
    throw new Error("Agent message experiment tool effects are invalid");
  }
  validateAgentMessageExperimentNames(
    effects["writeToolNames"],
    "writeToolNames",
  );
  validateAgentMessageExperimentNames(
    effects["unknownToolNames"],
    "unknownToolNames",
  );
  return structuredClone(
    effects,
  ) as unknown as AgentMessageExperimentToolEffects;
}

export function validateAgentMessageExperimentNames(
  input: unknown,
  label: string,
): string[] {
  if (
    !Array.isArray(input) ||
    input.length > 128 ||
    input.some((name) => typeof name !== "string" || !TOOL_NAME.test(name)) ||
    canonicalJson(input) !==
      canonicalJson(
        [...new Set(input)].sort((left, right) => left.localeCompare(right)),
      )
  ) {
    throw new Error(`Agent message experiment ${label} is invalid`);
  }
  return input as string[];
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
  if (
    typeof observation["threadId"] !== "string" ||
    !THREAD_ID.test(observation["threadId"]) ||
    typeof observation["runId"] !== "string" ||
    !RUN_ID.test(observation["runId"]) ||
    !RUN_STATUSES.has(String(observation["status"])) ||
    typeof observation["configurationSha256"] !== "string" ||
    !HASH.test(observation["configurationSha256"]) ||
    !EXECUTION_MODES.has(observation["executionMode"] as RunExecutionMode)
  ) {
    throw new Error(`Agent message experiment ${label} is invalid`);
  }
  validateModel(observation["model"], `${label} model`);
  const metrics = validateMetrics(observation["metrics"]);
  validateAgentMessageExperimentNames(
    observation["toolNames"],
    `${label} toolNames`,
  );
  const toolEffects = validateAgentMessageExperimentToolEffects(
    observation["toolEffects"],
  );
  return {
    ...(structuredClone(
      observation,
    ) as unknown as AgentMessageExperimentRunObservation),
    metrics,
    toolEffects,
  };
}

function validateMetrics(input: unknown): RunMetrics {
  const metrics = record(input, "Agent message experiment metrics");
  exactKeys(metrics, [...METRIC_KEYS, "assistantTextSha256"]);
  if (
    !agentMessageExperimentMetricDeltaIsFinite(
      metrics as unknown as RunMetrics,
    ) ||
    METRIC_KEYS.filter((key) => key !== "costUsd").some(
      (key) => !nonNegativeInteger(metrics[key]),
    ) ||
    Number(metrics["costUsd"]) < 0 ||
    typeof metrics["assistantTextSha256"] !== "string" ||
    !HASH.test(metrics["assistantTextSha256"])
  ) {
    throw new Error("Agent message experiment metrics are invalid");
  }
  return structuredClone(metrics) as unknown as RunMetrics;
}

function validateMetricDelta(input: unknown): RunMetricDelta {
  const metrics = record(input, "Agent message experiment metric delta");
  exactKeys(metrics, [...METRIC_KEYS]);
  if (!agentMessageExperimentMetricDeltaIsFinite(metrics as RunMetricDelta)) {
    throw new Error("Agent message experiment metric delta is invalid");
  }
  return structuredClone(metrics) as unknown as RunMetricDelta;
}

function validateConfigurationDelta(input: unknown): RunConfigurationDelta {
  const delta = record(input, "Agent message experiment configuration delta");
  exactKeys(
    delta,
    CONFIGURATION_DELTA_KEYS,
    delta["status"] === "unavailable"
      ? new Set(["leftSha256", "rightSha256"])
      : undefined,
  );
  if (
    (delta["status"] !== "comparable" && delta["status"] !== "unavailable") ||
    (delta["leftSha256"] !== undefined &&
      !HASH.test(String(delta["leftSha256"]))) ||
    (delta["rightSha256"] !== undefined &&
      !HASH.test(String(delta["rightSha256"])))
  ) {
    throw new Error("Agent message experiment configuration delta is invalid");
  }
  validateConfigurationFields(delta["changedFields"]);
  for (const key of CONFIGURATION_DELTA_KEYS.slice(4)) {
    validateAgentMessageExperimentNames(delta[key], key);
  }
  return structuredClone(delta) as unknown as RunConfigurationDelta;
}

function validateConfigurationFields(input: unknown): void {
  if (
    !Array.isArray(input) ||
    input.length > CONFIGURATION_FIELDS.size ||
    input.some(
      (field) => typeof field !== "string" || !CONFIGURATION_FIELDS.has(field),
    ) ||
    new Set(input).size !== input.length
  ) {
    throw new Error(
      "Agent message experiment configuration fields are invalid",
    );
  }
}

function validateModel(input: unknown, label: string): ModelRef {
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

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
