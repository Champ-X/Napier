import type {
  AgentMessageExperimentPreview,
  AgentMessageExperimentResult,
  AgentMessageExperimentResultFrame,
  CreateAgentMessageExperimentRequest,
  ModelRef,
  StreamFrame,
} from "@napier/contracts";

import {
  validateAgentMessageExperimentComparison,
  validateAgentMessageExperimentNames,
  validateAgentMessageExperimentToolEffects,
} from "./agent-message-experiment-comparison-protocol.js";
import { canonicalJson, sha256 } from "./ed25519.js";

export const MAX_AGENT_MESSAGE_EXPERIMENT_REQUEST_BYTES = 16 * 1024;
export const MAX_AGENT_MESSAGE_EXPERIMENT_RESULT_BYTES = 512 * 1024;

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const AGENT_ID = /^agent_[a-z0-9_]{2,80}$/u;
const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export function validateCreateAgentMessageExperimentRequest(
  input: unknown,
): CreateAgentMessageExperimentRequest {
  assertBytes(
    input,
    MAX_AGENT_MESSAGE_EXPERIMENT_REQUEST_BYTES,
    "Agent message experiment request",
  );
  const request = record(input, "Agent message experiment request");
  exactKeys(
    request,
    [
      "sourceRunId",
      "sourceMessageSeq",
      "model",
      "title",
      "toolResultMode",
      "expectedPreviewSha256",
    ],
    new Set(["model", "title", "toolResultMode", "expectedPreviewSha256"]),
  );
  if (
    typeof request["sourceRunId"] !== "string" ||
    !RUN_ID.test(request["sourceRunId"]) ||
    !positiveInteger(request["sourceMessageSeq"])
  ) {
    throw new Error("Agent message experiment source is invalid");
  }
  const model =
    request["model"] === undefined
      ? undefined
      : validateModel(request["model"], "Agent message experiment model");
  const title =
    request["title"] === undefined ? undefined : boundedTitle(request["title"]);
  const toolResultMode = request["toolResultMode"];
  if (
    toolResultMode !== undefined &&
    toolResultMode !== "live" &&
    toolResultMode !== "reuse_source"
  ) {
    throw new Error("Agent message experiment tool result mode is invalid");
  }
  const expectedPreviewSha256 = request["expectedPreviewSha256"];
  if (
    expectedPreviewSha256 !== undefined &&
    (typeof expectedPreviewSha256 !== "string" ||
      !HASH.test(expectedPreviewSha256))
  ) {
    throw new Error("Agent message experiment preview hash is invalid");
  }
  return {
    sourceRunId: request["sourceRunId"],
    sourceMessageSeq: Number(request["sourceMessageSeq"]),
    ...(model ? { model } : {}),
    ...(title ? { title } : {}),
    ...(toolResultMode ? { toolResultMode } : {}),
    ...(typeof expectedPreviewSha256 === "string"
      ? { expectedPreviewSha256 }
      : {}),
  };
}

export function validateAgentMessageExperimentPreview(
  input: unknown,
): AgentMessageExperimentPreview {
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
    typeof preview["sourcePromptVariableResolvedAt"] !== "string" ||
    !Number.isFinite(Date.parse(preview["sourcePromptVariableResolvedAt"])) ||
    new Date(preview["sourcePromptVariableResolvedAt"]).toISOString() !==
      preview["sourcePromptVariableResolvedAt"] ||
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
  validateModel(
    preview["sourceModel"],
    "Agent message experiment source model",
  );
  validateModel(
    preview["targetModel"],
    "Agent message experiment target model",
  );
  validateAgentMessageExperimentNames(
    preview["targetToolNames"],
    "targetToolNames",
  );
  validateAgentMessageExperimentToolEffects(preview["sourceToolEffects"]);
  const { previewSha256: _previewSha256, ...content } = preview;
  if (sha256(canonicalJson(content)) !== preview["previewSha256"]) {
    throw new Error("Agent message experiment preview hash mismatch");
  }
  return structuredClone(input) as AgentMessageExperimentPreview;
}

export function validateAgentMessageExperimentResult(
  input: unknown,
): AgentMessageExperimentResult {
  assertBytes(
    input,
    MAX_AGENT_MESSAGE_EXPERIMENT_RESULT_BYTES,
    "Agent message experiment result",
  );
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
  const preview = validateAgentMessageExperimentPreview(result["preview"]);
  const comparison = validateAgentMessageExperimentComparison(
    result["comparison"],
  );
  const toolResultReuse = validateToolResultReuse(result["toolResultReuse"]);
  if (
    result["kind"] !== "napier.agent-message-experiment-result" ||
    result["schemaVersion"] !== 2 ||
    !threadId(result["targetThreadId"]) ||
    !runId(result["targetRunId"]) ||
    !TERMINAL_RUN_STATUSES.has(String(result["status"])) ||
    (result["assistantText"] !== undefined &&
      (typeof result["assistantText"] !== "string" ||
        Buffer.byteLength(result["assistantText"], "utf8") > 64 * 1024)) ||
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
  return {
    ...(structuredClone(input) as AgentMessageExperimentResult),
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

export function createAgentMessageExperimentResultFrame(
  experiment: AgentMessageExperimentResult,
  snapshot: Extract<StreamFrame, { type: "snapshot" }>,
  eventStreamSha256: string,
): AgentMessageExperimentResultFrame {
  const validated = validateAgentMessageExperimentResult(experiment);
  if (
    snapshot.detail.thread.id !== validated.targetThreadId ||
    snapshot.detail.thread.eventCount !== snapshot.detail.events.length ||
    !HASH.test(eventStreamSha256)
  ) {
    throw new Error("Agent message experiment snapshot binding is invalid");
  }
  const content = {
    type: "agent_message_experiment_result" as const,
    sourceThreadId: validated.preview.sourceThreadId,
    sourceRunId: validated.preview.sourceRunId,
    sourceMessageSeq: validated.preview.sourceMessageSeq,
    targetThreadId: validated.targetThreadId,
    targetRunId: validated.targetRunId,
    status: validated.status,
    previewSha256: validated.preview.previewSha256,
    experiment: validated,
    snapshotSha256: snapshot.detailSha256,
    snapshotBytes: snapshot.detailBytes,
    eventCount: snapshot.detail.thread.eventCount,
    eventBytes: snapshot.eventBytes,
    eventStreamSha256,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateAgentMessageExperimentResultFrame(
  input: unknown,
): AgentMessageExperimentResultFrame {
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
  const experiment = validateAgentMessageExperimentResult(frame["experiment"]);
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
  if (sha256(canonicalJson(content)) !== frame["contentSha256"]) {
    throw new Error("Agent message experiment result frame hash mismatch");
  }
  return structuredClone(input) as AgentMessageExperimentResultFrame;
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

function boundedTitle(input: unknown): string {
  if (typeof input !== "string") {
    throw new Error("Agent message experiment title is invalid");
  }
  const title = input.replace(/\s+/gu, " ").trim();
  if (!title || title.length > 100 || /[\u0000-\u001f\u007f<>]/u.test(title)) {
    throw new Error("Agent message experiment title is invalid");
  }
  return title;
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

function hashFields(value: Record<string, unknown>, fields: string[]): boolean {
  return fields.every(
    (field) => typeof value[field] === "string" && HASH.test(value[field]),
  );
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
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

function assertBytes(value: unknown, maximum: number, label: string): void {
  if (Buffer.byteLength(canonicalJson(value), "utf8") > maximum) {
    throw new Error(`${label} exceeds its byte limit`);
  }
}
