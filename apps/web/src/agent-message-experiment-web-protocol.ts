import type {
  AgentMessageExperimentPreview,
  AgentMessageExperimentResult,
  AgentMessageExperimentResultFrame,
} from "@napier/contracts";

import {
  validateAgentMessageExperimentComparison,
  validateAgentMessageExperimentNames,
  validateAgentMessageExperimentToolEffects,
} from "./agent-message-experiment-comparison-web-protocol";
import { canonicalJson, sha256Text } from "./stable-digest";

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const AGENT_ID = /^agent_[a-z0-9_]{2,80}$/u;
const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export async function validateAgentMessageExperimentPreview(
  input: unknown,
): Promise<AgentMessageExperimentPreview> {
  const preview = record(input, "Agent message experiment preview");
  exactKeys(preview, [
    "kind",
    "schemaVersion",
    "sourceThreadId",
    "sourceRunId",
    "sourceMessageSeq",
    "branchFromSeq",
    "sourceAgentId",
    "sourceAgentRevision",
    "sourceRunConfigurationSha256",
    "sourcePromptVariableResolvedAt",
    "sourcePromptSha256",
    "sourceHistorySha256",
    "sourceHistoryMessageCount",
    "sourceMemoryContextSha256",
    "sourceSkillCatalogSha256",
    "candidateWorkspaceSnapshotSha256",
    "candidateWorkspaceFileCount",
    "candidateWorkspaceBytes",
    "sourceModel",
    "targetModel",
    "targetExecutionMode",
    "targetToolNames",
    "sourceToolEffects",
    "toolResultMode",
    "sourceReusableToolResultCount",
    "sourceToolResultSetSha256",
    "previewSha256",
  ]);
  const sourceModel = validateModel(preview["sourceModel"], "source model");
  const targetModel = validateModel(preview["targetModel"], "target model");
  const targetToolNames = validateAgentMessageExperimentNames(
    preview["targetToolNames"],
    "targetToolNames",
  );
  const sourceToolEffects = validateAgentMessageExperimentToolEffects(
    preview["sourceToolEffects"],
  );
  if (
    preview["kind"] !== "napier.agent-message-experiment-preview" ||
    preview["schemaVersion"] !== 2 ||
    !threadId(preview["sourceThreadId"]) ||
    !runId(preview["sourceRunId"]) ||
    !positiveInteger(preview["sourceMessageSeq"]) ||
    !nonNegativeInteger(preview["branchFromSeq"]) ||
    Number(preview["branchFromSeq"]) + 1 !==
      Number(preview["sourceMessageSeq"]) ||
    typeof preview["sourceAgentId"] !== "string" ||
    !AGENT_ID.test(preview["sourceAgentId"]) ||
    !positiveInteger(preview["sourceAgentRevision"]) ||
    !isoTimestamp(preview["sourcePromptVariableResolvedAt"]) ||
    !hashFields(preview, [
      "sourceRunConfigurationSha256",
      "sourcePromptSha256",
      "sourceHistorySha256",
      "sourceMemoryContextSha256",
      "sourceSkillCatalogSha256",
      "candidateWorkspaceSnapshotSha256",
      "sourceToolResultSetSha256",
      "previewSha256",
    ]) ||
    !nonNegativeInteger(preview["sourceHistoryMessageCount"]) ||
    !nonNegativeInteger(preview["candidateWorkspaceFileCount"]) ||
    !nonNegativeInteger(preview["candidateWorkspaceBytes"]) ||
    !nonNegativeInteger(preview["sourceReusableToolResultCount"]) ||
    (preview["toolResultMode"] !== "live" &&
      preview["toolResultMode"] !== "reuse_source") ||
    (preview["toolResultMode"] === "reuse_source" &&
      Number(preview["sourceReusableToolResultCount"]) < 1) ||
    preview["targetExecutionMode"] !== "agent_experiment_read_only"
  ) {
    throw new Error("Agent message experiment preview is invalid");
  }
  const { previewSha256: _previewSha256, ...content } = preview;
  if ((await sha256Text(canonicalJson(content))) !== preview["previewSha256"]) {
    throw new Error("Agent message experiment preview hash is invalid");
  }
  return {
    ...(structuredClone(preview) as unknown as AgentMessageExperimentPreview),
    sourceModel,
    targetModel,
    targetToolNames,
    sourceToolEffects,
  };
}

export async function validateAgentMessageExperimentResult(
  input: unknown,
): Promise<AgentMessageExperimentResult> {
  const result = record(input, "Agent message experiment result");
  exactKeys(
    result,
    [
      "kind",
      "schemaVersion",
      "preview",
      "targetThreadId",
      "targetRunId",
      "status",
      "assistantText",
      "toolResultReuse",
      "comparison",
    ],
    new Set(["assistantText"]),
  );
  const preview = await validateAgentMessageExperimentPreview(
    result["preview"],
  );
  const comparison = await validateAgentMessageExperimentComparison(
    result["comparison"],
  );
  const toolResultReuse = validateToolResultReuse(result["toolResultReuse"]);
  const assistantText = result["assistantText"];
  if (
    result["kind"] !== "napier.agent-message-experiment-result" ||
    result["schemaVersion"] !== 2 ||
    !threadId(result["targetThreadId"]) ||
    result["targetThreadId"] === preview.sourceThreadId ||
    !runId(result["targetRunId"]) ||
    !TERMINAL_STATUSES.has(String(result["status"])) ||
    (assistantText !== undefined &&
      (typeof assistantText !== "string" ||
        new TextEncoder().encode(assistantText).byteLength > 64 * 1024)) ||
    comparison.source.threadId !== preview.sourceThreadId ||
    comparison.source.runId !== preview.sourceRunId ||
    comparison.target.threadId !== result["targetThreadId"] ||
    comparison.target.runId !== result["targetRunId"] ||
    comparison.target.status !== result["status"] ||
    comparison.target.executionMode !== "agent_experiment_read_only" ||
    toolResultReuse.mode !== preview.toolResultMode ||
    toolResultReuse.sourceResultCount !==
      preview.sourceReusableToolResultCount ||
    toolResultReuse.sourceResultSetSha256 !==
      preview.sourceToolResultSetSha256 ||
    (result["status"] === "completed" && !toolResultReuse.complete)
  ) {
    throw new Error("Agent message experiment result binding is invalid");
  }
  const expectedAssistantSha256 = await sha256Text(
    typeof assistantText === "string" ? assistantText : "",
  );
  if (
    comparison.target.metrics.assistantTextSha256 !== expectedAssistantSha256
  ) {
    throw new Error("Agent message experiment result output hash is invalid");
  }
  return {
    ...(structuredClone(result) as unknown as AgentMessageExperimentResult),
    preview,
    comparison,
    toolResultReuse,
  };
}

function validateToolResultReuse(
  input: unknown,
): AgentMessageExperimentResult["toolResultReuse"] {
  const value = record(input, "Agent message experiment tool result reuse");
  exactKeys(value, [
    "mode",
    "sourceResultCount",
    "reusedResultCount",
    "divergenceCount",
    "complete",
    "sourceResultSetSha256",
    "targetReuseSetSha256",
  ]);
  if (
    (value["mode"] !== "live" && value["mode"] !== "reuse_source") ||
    !nonNegativeInteger(value["sourceResultCount"]) ||
    !nonNegativeInteger(value["reusedResultCount"]) ||
    Number(value["reusedResultCount"]) > Number(value["sourceResultCount"]) ||
    !nonNegativeInteger(value["divergenceCount"]) ||
    typeof value["complete"] !== "boolean" ||
    !hash(value["sourceResultSetSha256"]) ||
    !hash(value["targetReuseSetSha256"]) ||
    (value["mode"] === "live" &&
      (value["reusedResultCount"] !== 0 ||
        value["divergenceCount"] !== 0 ||
        value["complete"] !== true)) ||
    (value["mode"] === "reuse_source" &&
      value["complete"] !==
        (value["divergenceCount"] === 0 &&
          value["reusedResultCount"] === value["sourceResultCount"]))
  ) {
    throw new Error("Agent message experiment tool result reuse is invalid");
  }
  return structuredClone(
    value,
  ) as unknown as AgentMessageExperimentResult["toolResultReuse"];
}

export async function validateAgentMessageExperimentResultFrame(
  input: unknown,
): Promise<AgentMessageExperimentResultFrame> {
  const frame = record(input, "Agent message experiment result frame");
  exactKeys(frame, [
    "type",
    "sourceThreadId",
    "sourceRunId",
    "sourceMessageSeq",
    "targetThreadId",
    "targetRunId",
    "status",
    "previewSha256",
    "experiment",
    "snapshotSha256",
    "snapshotBytes",
    "eventCount",
    "eventBytes",
    "eventStreamSha256",
    "contentSha256",
  ]);
  const experiment = await validateAgentMessageExperimentResult(
    frame["experiment"],
  );
  if (
    frame["type"] !== "agent_message_experiment_result" ||
    frame["sourceThreadId"] !== experiment.preview.sourceThreadId ||
    frame["sourceRunId"] !== experiment.preview.sourceRunId ||
    frame["sourceMessageSeq"] !== experiment.preview.sourceMessageSeq ||
    frame["targetThreadId"] !== experiment.targetThreadId ||
    frame["targetRunId"] !== experiment.targetRunId ||
    frame["status"] !== experiment.status ||
    frame["previewSha256"] !== experiment.preview.previewSha256 ||
    !hashFields(frame, [
      "snapshotSha256",
      "eventStreamSha256",
      "contentSha256",
    ]) ||
    !nonNegativeInteger(frame["snapshotBytes"]) ||
    !nonNegativeInteger(frame["eventCount"]) ||
    !nonNegativeInteger(frame["eventBytes"])
  ) {
    throw new Error("Agent message experiment result frame is invalid");
  }
  const { contentSha256: _contentSha256, ...content } = frame;
  if ((await sha256Text(canonicalJson(content))) !== frame["contentSha256"]) {
    throw new Error("Agent message experiment result frame hash is invalid");
  }
  return {
    ...(structuredClone(frame) as unknown as AgentMessageExperimentResultFrame),
    experiment,
  };
}

function validateModel(input: unknown, label: string) {
  const model = record(input, `Agent message experiment ${label}`);
  exactKeys(model, ["provider", "id"]);
  if (
    typeof model["provider"] !== "string" ||
    !PROVIDER_ID.test(model["provider"]) ||
    typeof model["id"] !== "string" ||
    !MODEL_ID.test(model["id"])
  ) {
    throw new Error(`Agent message experiment ${label} is invalid`);
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

function threadId(value: unknown): value is string {
  return typeof value === "string" && THREAD_ID.test(value);
}

function runId(value: unknown): value is string {
  return typeof value === "string" && RUN_ID.test(value);
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function hashFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.every((field) => hash(value[field]));
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function isoTimestamp(value: unknown): boolean {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
