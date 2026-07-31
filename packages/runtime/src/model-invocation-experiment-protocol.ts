import type {
  CreateModelInvocationExperimentRequest,
  ModelInvocationExperimentPreview,
  ModelInvocationExperimentResult,
  ModelInvocationExperimentResultFrame,
  ModelInvocationPurpose,
  ModelRef,
  StreamFrame,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { validateModelInvocationExperimentComparison } from "./model-invocation-experiment-comparison-protocol.js";

export const MAX_MODEL_INVOCATION_EXPERIMENT_REQUEST_BYTES = 16 * 1024;
export const MAX_MODEL_INVOCATION_EXPERIMENT_RESULT_BYTES = 512 * 1024;

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const AGENT_ID = /^agent_[a-z0-9_]{2,80}$/u;
const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const PURPOSES = new Set<ModelInvocationPurpose>([
  "agent_turn",
  "context_compaction",
  "goal_evaluation",
  "memory_extraction",
]);
const STATUSES = new Set(["completed", "failed", "cancelled"]);
const STOP_REASONS = new Set(["stop", "length", "toolUse", "error", "aborted"]);

export function validateCreateModelInvocationExperimentRequest(
  input: unknown,
): CreateModelInvocationExperimentRequest {
  const value = record(input, "Model invocation experiment request");
  exactKeys(
    value,
    ["sourceRunId", "sourceTurnIndex"],
    new Set(["model", "title", "expectedPreviewSha256"]),
  );
  if (
    typeof value["sourceRunId"] !== "string" ||
    !RUN_ID.test(value["sourceRunId"]) ||
    !nonNegativeInteger(value["sourceTurnIndex"]) ||
    (value["expectedPreviewSha256"] !== undefined &&
      !hash(value["expectedPreviewSha256"]))
  ) {
    throw new Error("Model invocation experiment request is invalid");
  }
  const title =
    value["title"] === undefined ? undefined : normalizeTitle(value["title"]);
  return {
    sourceRunId: value["sourceRunId"],
    sourceTurnIndex: value["sourceTurnIndex"],
    ...(value["model"] !== undefined
      ? { model: validateModel(value["model"]) }
      : {}),
    ...(title ? { title } : {}),
    ...(typeof value["expectedPreviewSha256"] === "string"
      ? { expectedPreviewSha256: value["expectedPreviewSha256"] }
      : {}),
  };
}

export function validateModelInvocationExperimentPreview(
  input: unknown,
): ModelInvocationExperimentPreview {
  const value = record(input, "Model invocation experiment preview");
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "sourceThreadId",
    "sourceRunId",
    "sourceAgentId",
    "sourceAgentRevision",
    "sourceTurnIndex",
    "sourceCapsuleEventSeq",
    "sourceResponseEventSeq",
    "purpose",
    "sourceModel",
    "targetModel",
    "sourceContextEnvelopeSha256",
    "sourceContextSha256",
    "sourceCapsuleSha256",
    "sourceCapsuleBytes",
    "sourceMessageCount",
    "sourceToolCount",
    "sourceOutputSha256",
    "sourceTextSha256",
    "sourceStopReason",
    "targetExecutionMode",
    "previewSha256",
  ]);
  const sourceModel = validateModel(value["sourceModel"]);
  const targetModel = validateModel(value["targetModel"]);
  if (
    value["kind"] !== "napier.model-invocation-experiment-preview" ||
    value["schemaVersion"] !== 1 ||
    typeof value["sourceThreadId"] !== "string" ||
    !THREAD_ID.test(value["sourceThreadId"]) ||
    typeof value["sourceRunId"] !== "string" ||
    !RUN_ID.test(value["sourceRunId"]) ||
    typeof value["sourceAgentId"] !== "string" ||
    !AGENT_ID.test(value["sourceAgentId"]) ||
    !positiveInteger(value["sourceAgentRevision"]) ||
    !nonNegativeInteger(value["sourceTurnIndex"]) ||
    !positiveInteger(value["sourceCapsuleEventSeq"]) ||
    !positiveInteger(value["sourceResponseEventSeq"]) ||
    value["sourceResponseEventSeq"] <= value["sourceCapsuleEventSeq"] ||
    typeof value["purpose"] !== "string" ||
    !PURPOSES.has(value["purpose"] as ModelInvocationPurpose) ||
    !hashFields(value, [
      "sourceContextEnvelopeSha256",
      "sourceContextSha256",
      "sourceCapsuleSha256",
      "sourceOutputSha256",
      "sourceTextSha256",
      "previewSha256",
    ]) ||
    !positiveInteger(value["sourceCapsuleBytes"]) ||
    !nonNegativeInteger(value["sourceMessageCount"]) ||
    !nonNegativeInteger(value["sourceToolCount"]) ||
    typeof value["sourceStopReason"] !== "string" ||
    !STOP_REASONS.has(value["sourceStopReason"]) ||
    value["targetExecutionMode"] !== "model_experiment_single_call"
  ) {
    throw new Error("Model invocation experiment preview is invalid");
  }
  const content = {
    ...value,
    sourceModel,
    targetModel,
  } as Record<string, unknown>;
  delete content["previewSha256"];
  if (sha256(canonicalJson(content)) !== value["previewSha256"]) {
    throw new Error("Model invocation experiment preview hash is invalid");
  }
  return structuredClone(value) as unknown as ModelInvocationExperimentPreview;
}

export function validateModelInvocationExperimentResult(
  input: unknown,
): ModelInvocationExperimentResult {
  const value = record(input, "Model invocation experiment result");
  exactKeys(
    value,
    [
      "kind",
      "schemaVersion",
      "preview",
      "targetThreadId",
      "targetRunId",
      "status",
      "candidateToolCallNames",
      "comparison",
    ],
    new Set(["assistantText"]),
  );
  const preview = validateModelInvocationExperimentPreview(value["preview"]);
  const comparison = validateModelInvocationExperimentComparison(
    value["comparison"],
  );
  const candidateToolCallNames = validateNames(value["candidateToolCallNames"]);
  const assistantText = value["assistantText"];
  if (
    value["kind"] !== "napier.model-invocation-experiment-result" ||
    value["schemaVersion"] !== 1 ||
    typeof value["targetThreadId"] !== "string" ||
    !THREAD_ID.test(value["targetThreadId"]) ||
    value["targetThreadId"] === preview.sourceThreadId ||
    typeof value["targetRunId"] !== "string" ||
    !RUN_ID.test(value["targetRunId"]) ||
    typeof value["status"] !== "string" ||
    !STATUSES.has(value["status"]) ||
    (assistantText !== undefined &&
      (typeof assistantText !== "string" ||
        Buffer.byteLength(assistantText, "utf8") > 64 * 1024)) ||
    comparison.source.threadId !== preview.sourceThreadId ||
    comparison.source.runId !== preview.sourceRunId ||
    comparison.target.threadId !== value["targetThreadId"] ||
    comparison.target.runId !== value["targetRunId"] ||
    comparison.target.status !== value["status"] ||
    canonicalJson(candidateToolCallNames) !==
      canonicalJson(comparison.target.toolNames) ||
    sha256(typeof assistantText === "string" ? assistantText : "") !==
      comparison.target.textSha256
  ) {
    throw new Error("Model invocation experiment result is invalid");
  }
  return {
    kind: value["kind"],
    schemaVersion: value["schemaVersion"],
    preview,
    targetThreadId: value["targetThreadId"],
    targetRunId: value["targetRunId"],
    status: value["status"],
    ...(typeof assistantText === "string" ? { assistantText } : {}),
    candidateToolCallNames,
    comparison,
  } as ModelInvocationExperimentResult;
}

export function createModelInvocationExperimentResultFrame(
  experiment: ModelInvocationExperimentResult,
  snapshot: Extract<StreamFrame, { type: "snapshot" }>,
  eventStreamSha256: string,
): ModelInvocationExperimentResultFrame {
  const content = {
    type: "model_invocation_experiment_result" as const,
    sourceThreadId: experiment.preview.sourceThreadId,
    sourceRunId: experiment.preview.sourceRunId,
    sourceTurnIndex: experiment.preview.sourceTurnIndex,
    targetThreadId: experiment.targetThreadId,
    targetRunId: experiment.targetRunId,
    status: experiment.status,
    previewSha256: experiment.preview.previewSha256,
    experiment,
    snapshotSha256: snapshot.detailSha256,
    snapshotBytes: snapshot.detailBytes,
    eventCount: snapshot.detail.thread.eventCount,
    eventBytes: snapshot.eventBytes,
    eventStreamSha256,
  };
  const frame = {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
  if (
    Buffer.byteLength(canonicalJson(frame), "utf8") >
    MAX_MODEL_INVOCATION_EXPERIMENT_RESULT_BYTES
  ) {
    throw new Error(
      "Model invocation experiment result exceeds its byte limit",
    );
  }
  return validateModelInvocationExperimentResultFrame(frame);
}

export function validateModelInvocationExperimentResultFrame(
  input: unknown,
): ModelInvocationExperimentResultFrame {
  const value = record(input, "Model invocation experiment result frame");
  exactKeys(value, [
    "type",
    "sourceThreadId",
    "sourceRunId",
    "sourceTurnIndex",
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
  const experiment = validateModelInvocationExperimentResult(
    value["experiment"],
  );
  if (
    value["type"] !== "model_invocation_experiment_result" ||
    value["sourceThreadId"] !== experiment.preview.sourceThreadId ||
    value["sourceRunId"] !== experiment.preview.sourceRunId ||
    value["sourceTurnIndex"] !== experiment.preview.sourceTurnIndex ||
    value["targetThreadId"] !== experiment.targetThreadId ||
    value["targetRunId"] !== experiment.targetRunId ||
    value["status"] !== experiment.status ||
    value["previewSha256"] !== experiment.preview.previewSha256 ||
    !hashFields(value, [
      "snapshotSha256",
      "eventStreamSha256",
      "contentSha256",
    ]) ||
    !nonNegativeInteger(value["snapshotBytes"]) ||
    !nonNegativeInteger(value["eventCount"]) ||
    !nonNegativeInteger(value["eventBytes"])
  ) {
    throw new Error("Model invocation experiment result frame is invalid");
  }
  const content = { ...value };
  delete content["contentSha256"];
  if (sha256(canonicalJson(content)) !== value["contentSha256"]) {
    throw new Error("Model invocation experiment result frame hash is invalid");
  }
  return {
    ...structuredClone(value),
    experiment,
  } as unknown as ModelInvocationExperimentResultFrame;
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

function validateNames(input: unknown): string[] {
  if (
    !Array.isArray(input) ||
    input.length > 256 ||
    input.some((name) => typeof name !== "string")
  ) {
    throw new Error("Model invocation experiment tool names are invalid");
  }
  const names = [...new Set(input)].sort((left, right) =>
    left.localeCompare(right),
  );
  if (canonicalJson(input) !== canonicalJson(names)) {
    throw new Error("Model invocation experiment tool names are invalid");
  }
  return names;
}

function normalizeTitle(input: unknown): string {
  if (typeof input !== "string") {
    throw new Error("Model invocation experiment title is invalid");
  }
  const title = input.replace(/\s+/gu, " ").trim();
  if (
    title.length < 1 ||
    title.length > 160 ||
    /[\u0000-\u001f\u007f<>]/u.test(title)
  ) {
    throw new Error("Model invocation experiment title is invalid");
  }
  return title;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: ReadonlySet<string> = new Set(),
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
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

function hashFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.every((field) => hash(value[field]));
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
