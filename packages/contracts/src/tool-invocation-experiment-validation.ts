import type {
  CreateToolInvocationExperimentRequest,
  ToolInvocationExperimentPreview,
  ToolInvocationExperimentResult,
} from "./execution-experiments.js";
import type {
  StreamFrame,
  ToolInvocationExperimentResultFrame,
} from "./stream-frame-v1.js";

import { canonical as canonicalJson, sha256 } from "./skill-load-validation.js";
import { validateToolInvocationExperimentComparison } from "./tool-invocation-experiment-comparison-validation.js";

export const MAX_TOOL_INVOCATION_EXPERIMENT_REQUEST_BYTES = 16 * 1024;
export const MAX_TOOL_INVOCATION_EXPERIMENT_RESULT_BYTES = 1024 * 1024;

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const AGENT_ID = /^agent_[a-z0-9_]{2,80}$/u;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
const STATUSES = new Set(["completed", "failed", "cancelled"]);

export function validateCreateToolInvocationExperimentRequest(
  input: unknown,
): CreateToolInvocationExperimentRequest {
  const value = record(input, "Tool invocation experiment request");
  exactKeys(
    value,
    ["sourceRunId", "sourceCallId"],
    new Set(["title", "expectedPreviewSha256"]),
  );
  if (
    typeof value["sourceRunId"] !== "string" ||
    !RUN_ID.test(value["sourceRunId"]) ||
    !callId(value["sourceCallId"]) ||
    (value["expectedPreviewSha256"] !== undefined &&
      !hash(value["expectedPreviewSha256"]))
  ) {
    throw new Error("Tool invocation experiment request is invalid");
  }
  const title =
    value["title"] === undefined ? undefined : normalizeTitle(value["title"]);
  return {
    sourceRunId: value["sourceRunId"],
    sourceCallId: value["sourceCallId"],
    ...(title ? { title } : {}),
    ...(typeof value["expectedPreviewSha256"] === "string"
      ? { expectedPreviewSha256: value["expectedPreviewSha256"] }
      : {}),
  };
}

export function validateToolInvocationExperimentPreview(
  input: unknown,
): ToolInvocationExperimentPreview {
  const value = record(input, "Tool invocation experiment preview");
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "sourceThreadId",
    "sourceRunId",
    "sourceAgentId",
    "sourceAgentRevision",
    "sourceCallId",
    "sourceCapsuleEventSeq",
    "sourceStartedEventSeq",
    "sourceTerminalEventSeq",
    "sourceToolName",
    "sourceEffect",
    "sourceToolDefinitionSha256",
    "sourceArgumentsSha256",
    "sourceWorkspaceScopeSha256",
    "sourceCapsuleSha256",
    "sourceCapsuleBytes",
    "sourceDurationMs",
    "sourceOutputSha256",
    "sourceOutputBytes",
    "candidateWorkspaceSnapshotSha256",
    "candidateWorkspaceFileCount",
    "candidateWorkspaceBytes",
    "targetExecutionMode",
    "previewSha256",
  ]);
  if (
    !validToolInvocationPreviewIdentity(value) ||
    !validToolInvocationPreviewEvidence(value)
  ) {
    throw new Error("Tool invocation experiment preview is invalid");
  }
  const content = { ...value };
  delete content["previewSha256"];
  if (sha256(canonicalJson(content)) !== value["previewSha256"]) {
    throw new Error("Tool invocation experiment preview hash is invalid");
  }
  return structuredClone(value) as unknown as ToolInvocationExperimentPreview;
}

function validToolInvocationPreviewIdentity(
  value: Record<string, unknown>,
): boolean {
  return (
    value["kind"] === "napier.tool-invocation-experiment-preview" &&
    value["schemaVersion"] === 1 &&
    typeof value["sourceThreadId"] === "string" &&
    THREAD_ID.test(value["sourceThreadId"]) &&
    typeof value["sourceRunId"] === "string" &&
    RUN_ID.test(value["sourceRunId"]) &&
    typeof value["sourceAgentId"] === "string" &&
    AGENT_ID.test(value["sourceAgentId"]) &&
    positiveInteger(value["sourceAgentRevision"]) &&
    callId(value["sourceCallId"]) &&
    typeof value["sourceToolName"] === "string" &&
    TOOL_NAME.test(value["sourceToolName"]) &&
    value["sourceEffect"] === "read"
  );
}

function validToolInvocationPreviewEvidence(
  value: Record<string, unknown>,
): boolean {
  return (
    positiveInteger(value["sourceCapsuleEventSeq"]) &&
    positiveInteger(value["sourceStartedEventSeq"]) &&
    positiveInteger(value["sourceTerminalEventSeq"]) &&
    value["sourceStartedEventSeq"] !== value["sourceCapsuleEventSeq"] &&
    value["sourceStartedEventSeq"] < value["sourceTerminalEventSeq"] &&
    value["sourceCapsuleEventSeq"] < value["sourceTerminalEventSeq"] &&
    hashFields(value, [
      "sourceToolDefinitionSha256",
      "sourceArgumentsSha256",
      "sourceWorkspaceScopeSha256",
      "sourceCapsuleSha256",
      "sourceOutputSha256",
      "candidateWorkspaceSnapshotSha256",
      "previewSha256",
    ]) &&
    positiveInteger(value["sourceCapsuleBytes"]) &&
    nonNegativeInteger(value["sourceDurationMs"]) &&
    nonNegativeInteger(value["sourceOutputBytes"]) &&
    value["sourceOutputBytes"] <= 512 * 1024 &&
    nonNegativeInteger(value["candidateWorkspaceFileCount"]) &&
    nonNegativeInteger(value["candidateWorkspaceBytes"]) &&
    value["targetExecutionMode"] === "tool_experiment_read_only"
  );
}

export function validateToolInvocationExperimentResult(
  input: unknown,
): ToolInvocationExperimentResult {
  const value = record(input, "Tool invocation experiment result");
  exactKeys(
    value,
    [
      "kind",
      "schemaVersion",
      "preview",
      "targetThreadId",
      "targetRunId",
      "status",
      "comparison",
    ],
    new Set(["candidateOutput"]),
  );
  const preview = validateToolInvocationExperimentPreview(value["preview"]);
  const comparison = validateToolInvocationExperimentComparison(
    value["comparison"],
  );
  const candidateOutput = value["candidateOutput"];
  if (
    !validToolInvocationResultIdentity(value, preview, candidateOutput) ||
    !validToolInvocationResultBinding(
      value,
      preview,
      comparison,
      candidateOutput,
    )
  ) {
    throw new Error(
      "Tool invocation experiment result binding is invalid (result is invalid)",
    );
  }
  return {
    kind: value["kind"],
    schemaVersion: value["schemaVersion"],
    preview,
    targetThreadId: value["targetThreadId"],
    targetRunId: value["targetRunId"],
    status: value["status"],
    ...(typeof candidateOutput === "string" ? { candidateOutput } : {}),
    comparison,
  } as ToolInvocationExperimentResult;
}

function validToolInvocationResultIdentity(
  value: Record<string, unknown>,
  preview: ToolInvocationExperimentPreview,
  candidateOutput: unknown,
): boolean {
  return (
    value["kind"] === "napier.tool-invocation-experiment-result" &&
    value["schemaVersion"] === 1 &&
    typeof value["targetThreadId"] === "string" &&
    THREAD_ID.test(value["targetThreadId"]) &&
    value["targetThreadId"] !== preview.sourceThreadId &&
    typeof value["targetRunId"] === "string" &&
    RUN_ID.test(value["targetRunId"]) &&
    typeof value["status"] === "string" &&
    STATUSES.has(value["status"]) &&
    (value["status"] === "completed" || candidateOutput === undefined) &&
    (candidateOutput === undefined ||
      (typeof candidateOutput === "string" &&
        new TextEncoder().encode(candidateOutput).byteLength <= 512 * 1024))
  );
}

function validToolInvocationResultBinding(
  value: Record<string, unknown>,
  preview: ToolInvocationExperimentPreview,
  comparison: ReturnType<typeof validateToolInvocationExperimentComparison>,
  candidateOutput: unknown,
): boolean {
  const output = typeof candidateOutput === "string" ? candidateOutput : "";
  return (
    comparison.source.status === "completed" &&
    comparison.source.threadId === preview.sourceThreadId &&
    comparison.source.runId === preview.sourceRunId &&
    comparison.source.toolName === preview.sourceToolName &&
    comparison.source.durationMs === preview.sourceDurationMs &&
    comparison.source.outputSha256 === preview.sourceOutputSha256 &&
    comparison.source.outputBytes === preview.sourceOutputBytes &&
    comparison.target.threadId === value["targetThreadId"] &&
    comparison.target.runId === value["targetRunId"] &&
    comparison.target.status === value["status"] &&
    comparison.target.toolName === preview.sourceToolName &&
    sha256(output) === comparison.target.outputSha256 &&
    new TextEncoder().encode(output).byteLength ===
      comparison.target.outputBytes
  );
}

export function createToolInvocationExperimentResultFrame(
  experiment: ToolInvocationExperimentResult,
  snapshot: Extract<StreamFrame, { type: "snapshot" }>,
  eventStreamSha256: string,
): ToolInvocationExperimentResultFrame {
  const content = {
    type: "tool_invocation_experiment_result" as const,
    sourceThreadId: experiment.preview.sourceThreadId,
    sourceRunId: experiment.preview.sourceRunId,
    sourceCallId: experiment.preview.sourceCallId,
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
    new TextEncoder().encode(canonicalJson(frame)).byteLength >
    MAX_TOOL_INVOCATION_EXPERIMENT_RESULT_BYTES
  ) {
    throw new Error("Tool invocation experiment result exceeds its byte limit");
  }
  return validateToolInvocationExperimentResultFrame(frame);
}

export function validateToolInvocationExperimentResultFrame(
  input: unknown,
): ToolInvocationExperimentResultFrame {
  const value = record(input, "Tool invocation experiment result frame");
  exactKeys(value, [
    "type",
    "sourceThreadId",
    "sourceRunId",
    "sourceCallId",
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
  const experiment = validateToolInvocationExperimentResult(
    value["experiment"],
  );
  if (
    value["type"] !== "tool_invocation_experiment_result" ||
    value["sourceThreadId"] !== experiment.preview.sourceThreadId ||
    value["sourceRunId"] !== experiment.preview.sourceRunId ||
    value["sourceCallId"] !== experiment.preview.sourceCallId ||
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
    throw new Error("Tool invocation experiment result frame is invalid");
  }
  const content = { ...value };
  delete content["contentSha256"];
  if (sha256(canonicalJson(content)) !== value["contentSha256"]) {
    throw new Error("Tool invocation experiment result frame hash is invalid");
  }
  return {
    ...(structuredClone(
      value,
    ) as unknown as ToolInvocationExperimentResultFrame),
    experiment,
  };
}

function normalizeTitle(input: unknown): string {
  if (typeof input !== "string") {
    throw new Error("Tool invocation experiment title must be a string");
  }
  const title = input.replace(/\s+/gu, " ").trim();
  if (!title || title.length > 160) {
    throw new Error("Tool invocation experiment title is invalid");
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
    throw new Error("Tool invocation experiment fields are invalid");
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function callId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
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
