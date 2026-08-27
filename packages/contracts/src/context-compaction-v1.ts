import type { ModelRef } from "./execution-core.js";
import { canonical, sha256 } from "./skill-load-validation.js";
import type { ContextCheckpointSnapshot } from "./workspace-control-v1.js";

export interface PreviewContextCompactionRequest {
  retainedMessageCount: number;
  model: ModelRef;
}

export interface ApplyContextCompactionForkRequest {
  expectedPreviewSha256: string;
  title?: string;
}

export interface ContextCompactionPreview {
  kind: "napier.context-compaction-preview";
  schemaVersion: 1;
  previewRunId: string;
  sourceThreadId: string;
  sourceEventCount: number;
  sourceEventSetSha256: string;
  fromSeq: number;
  toSeq: number;
  retainedFromSeq: number;
  sourceMessageCount: number;
  sourceMessageSha256: string;
  continuityEventCount: number;
  continuitySha256: string;
  retainedMessageCount: number;
  model: ModelRef;
  summary: string;
  decisions: string[];
  openLoops: string[];
  artifacts: string[];
  previewSha256: string;
}

export interface ContextCompactionForkResult {
  kind: "napier.context-compaction-fork-result";
  schemaVersion: 1;
  sourceThreadId: string;
  targetThreadId: string;
  previewSha256: string;
  checkpoint: ContextCheckpointSnapshot & {
    continuityProjectionVersion: 1;
    continuityEventCount: number;
    continuitySha256: string;
  };
}

export const MAX_CONTEXT_COMPACTION_REQUEST_BYTES = 8 * 1024;

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;

export function validatePreviewContextCompactionRequest(
  input: unknown,
): PreviewContextCompactionRequest {
  assertRequestBytes(input);
  const value = record(input, "Context compaction preview request");
  exactKeys(value, ["retainedMessageCount", "model"]);
  const retainedMessageCount = value["retainedMessageCount"];
  if (
    !Number.isSafeInteger(retainedMessageCount) ||
    Number(retainedMessageCount) < 2 ||
    Number(retainedMessageCount) > 24
  ) {
    throw new Error(
      "Context compaction retained message count must be between 2 and 24",
    );
  }
  return {
    retainedMessageCount: Number(retainedMessageCount),
    model: validateModel(value["model"]),
  };
}

export function validateApplyContextCompactionForkRequest(
  input: unknown,
): ApplyContextCompactionForkRequest {
  assertRequestBytes(input);
  const value = record(input, "Context compaction fork request");
  exactKeys(value, ["expectedPreviewSha256", "title"], new Set(["title"]));
  const expectedPreviewSha256 = value["expectedPreviewSha256"];
  const title = value["title"];
  const normalizedTitle =
    typeof title === "string" ? title.replace(/\s+/gu, " ").trim() : undefined;
  if (
    typeof expectedPreviewSha256 !== "string" ||
    !HASH.test(expectedPreviewSha256) ||
    (title !== undefined && (!normalizedTitle || normalizedTitle.length > 100))
  ) {
    throw new Error("Context compaction fork request is invalid");
  }
  return {
    expectedPreviewSha256,
    ...(normalizedTitle ? { title: normalizedTitle } : {}),
  };
}

export function validateContextCompactionPreview(
  input: unknown,
): ContextCompactionPreview {
  const value = record(input, "Context compaction preview");
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "previewRunId",
    "sourceThreadId",
    "sourceEventCount",
    "sourceEventSetSha256",
    "fromSeq",
    "toSeq",
    "retainedFromSeq",
    "sourceMessageCount",
    "sourceMessageSha256",
    "continuityEventCount",
    "continuitySha256",
    "retainedMessageCount",
    "model",
    "summary",
    "decisions",
    "openLoops",
    "artifacts",
    "previewSha256",
  ]);
  if (
    !validPreviewIdentity(value) ||
    !validPreviewRange(value) ||
    !validPreviewContent(value)
  ) {
    throw new Error("Context compaction preview is invalid");
  }
  validateModel(value["model"]);
  const { previewSha256: _previewSha256, ...content } = value;
  if (sha256(canonical(content)) !== value["previewSha256"]) {
    throw new Error("Context compaction preview hash is invalid");
  }
  return structuredClone(input) as ContextCompactionPreview;
}

function validPreviewIdentity(value: Record<string, unknown>): boolean {
  return (
    value["kind"] === "napier.context-compaction-preview" &&
    value["schemaVersion"] === 1 &&
    typeof value["previewRunId"] === "string" &&
    RUN_ID.test(value["previewRunId"]) &&
    typeof value["sourceThreadId"] === "string" &&
    THREAD_ID.test(value["sourceThreadId"]) &&
    hashFields(value, [
      "sourceEventSetSha256",
      "sourceMessageSha256",
      "continuitySha256",
      "previewSha256",
    ])
  );
}

function validPreviewRange(value: Record<string, unknown>): boolean {
  return (
    positiveInteger(value["sourceEventCount"]) &&
    positiveInteger(value["fromSeq"]) &&
    positiveInteger(value["toSeq"]) &&
    positiveInteger(value["retainedFromSeq"]) &&
    Number(value["fromSeq"]) <= Number(value["toSeq"]) &&
    Number(value["toSeq"]) < Number(value["retainedFromSeq"]) &&
    Number(value["retainedFromSeq"]) <= Number(value["sourceEventCount"]) &&
    positiveInteger(value["sourceMessageCount"]) &&
    nonNegativeInteger(value["continuityEventCount"])
  );
}

function validPreviewContent(value: Record<string, unknown>): boolean {
  return (
    Number.isSafeInteger(value["retainedMessageCount"]) &&
    Number(value["retainedMessageCount"]) >= 2 &&
    Number(value["retainedMessageCount"]) <= 24 &&
    typeof value["summary"] === "string" &&
    value["summary"].length >= 1 &&
    value["summary"].length <= 6_000 &&
    boundedStringList(value["decisions"]) &&
    boundedStringList(value["openLoops"]) &&
    boundedStringList(value["artifacts"]) &&
    checkpointContentSize(value) <= 8_000
  );
}

export function validateContextCompactionForkResult(
  input: unknown,
): ContextCompactionForkResult {
  const value = record(input, "Context compaction fork result");
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "sourceThreadId",
    "targetThreadId",
    "previewSha256",
    "checkpoint",
  ]);
  if (
    value["kind"] !== "napier.context-compaction-fork-result" ||
    value["schemaVersion"] !== 1 ||
    typeof value["sourceThreadId"] !== "string" ||
    !THREAD_ID.test(value["sourceThreadId"]) ||
    typeof value["targetThreadId"] !== "string" ||
    !THREAD_ID.test(value["targetThreadId"]) ||
    value["sourceThreadId"] === value["targetThreadId"] ||
    typeof value["previewSha256"] !== "string" ||
    !HASH.test(value["previewSha256"])
  ) {
    throw new Error("Context compaction fork result is invalid");
  }
  validateCheckpoint(value["checkpoint"]);
  return structuredClone(input) as ContextCompactionForkResult;
}

function assertRequestBytes(input: unknown): void {
  if (
    new TextEncoder().encode(JSON.stringify(input)).byteLength >
    MAX_CONTEXT_COMPACTION_REQUEST_BYTES
  ) {
    throw new Error("Context compaction request is too large");
  }
}

function validateModel(input: unknown): ModelRef {
  const value = record(input, "Context compaction model");
  exactKeys(value, ["provider", "id"]);
  if (
    typeof value["provider"] !== "string" ||
    !PROVIDER_ID.test(value["provider"]) ||
    typeof value["id"] !== "string" ||
    !MODEL_ID.test(value["id"])
  ) {
    throw new Error("Context compaction model is invalid");
  }
  return { provider: value["provider"], id: value["id"] };
}

function boundedStringList(input: unknown): input is string[] {
  return (
    Array.isArray(input) &&
    input.length <= 50 &&
    input.every(
      (item) =>
        typeof item === "string" && item.length > 0 && item.length <= 1_000,
    )
  );
}

function checkpointContentSize(value: Record<string, unknown>): number {
  const entries: unknown[] = [
    value["summary"],
    ...(value["decisions"] as string[]),
    ...(value["openLoops"] as string[]),
    ...(value["artifacts"] as string[]),
  ];
  return entries.reduce<number>(
    (total, item) => total + String(item).length,
    0,
  );
}

function validateCheckpoint(input: unknown): void {
  const value = record(input, "Context compaction checkpoint");
  exactKeys(
    value,
    [
      "schemaVersion",
      "checkpointId",
      "parentCheckpointId",
      "fromSeq",
      "toSeq",
      "retainedFromSeq",
      "sourceEventCount",
      "sourceSha256",
      "summarySha256",
      "continuityProjectionVersion",
      "continuityEventCount",
      "continuitySha256",
      "summary",
      "decisions",
      "openLoops",
      "artifacts",
    ],
    new Set(["parentCheckpointId"]),
  );
  const parentCheckpointId = value["parentCheckpointId"];
  if (
    value["schemaVersion"] !== 1 ||
    typeof value["checkpointId"] !== "string" ||
    !/^checkpoint_[a-z0-9_-]{8,80}$/u.test(value["checkpointId"]) ||
    (parentCheckpointId !== undefined &&
      (typeof parentCheckpointId !== "string" ||
        !/^checkpoint_[a-z0-9_-]{8,80}$/u.test(parentCheckpointId))) ||
    !positiveInteger(value["fromSeq"]) ||
    !positiveInteger(value["toSeq"]) ||
    !positiveInteger(value["retainedFromSeq"]) ||
    Number(value["fromSeq"]) > Number(value["toSeq"]) ||
    Number(value["toSeq"]) >= Number(value["retainedFromSeq"]) ||
    !positiveInteger(value["sourceEventCount"]) ||
    !hashFields(value, ["sourceSha256", "summarySha256"]) ||
    value["continuityProjectionVersion"] !== 1 ||
    !nonNegativeInteger(value["continuityEventCount"]) ||
    typeof value["continuitySha256"] !== "string" ||
    !HASH.test(value["continuitySha256"]) ||
    typeof value["summary"] !== "string" ||
    value["summary"].length < 1 ||
    value["summary"].length > 6_000 ||
    !boundedStringList(value["decisions"]) ||
    !boundedStringList(value["openLoops"]) ||
    !boundedStringList(value["artifacts"]) ||
    checkpointContentSize(value) > 8_000
  ) {
    throw new Error("Context compaction checkpoint is invalid");
  }
}

function positiveInteger(input: unknown): boolean {
  return Number.isSafeInteger(input) && Number(input) > 0;
}

function nonNegativeInteger(input: unknown): boolean {
  return Number.isSafeInteger(input) && Number(input) >= 0;
}

function hashFields(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every(
    (key) => typeof value[key] === "string" && HASH.test(value[key]),
  );
}

function record(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label} is invalid`);
  }
  return input as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: string[],
  optional = new Set<string>(),
): void {
  const allowed = new Set(keys);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    keys.some((key) => !optional.has(key) && !(key in value))
  ) {
    throw new Error("Context compaction object shape is invalid");
  }
}
