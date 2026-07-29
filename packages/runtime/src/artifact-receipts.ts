import type { RunEvent } from "@napier/contracts";

const SHA256 = /^[a-f0-9]{64}$/;
const ARTIFACT_RECEIPT_EVENTS = new Set([
  "artifact.data_profiled",
  "artifact.directory_manifested",
  "artifact.drift_checked",
  "artifact.exported",
  "artifact.previewed",
]);

const ARTIFACT_EXPORTED_KEYS = [
  "planId",
  "artifactId",
  "planRevision",
  "status",
  "kind",
  "pathSha256",
  "sha256",
  "sizeBytes",
];

const ARTIFACT_PREVIEWED_KEYS = [
  ...ARTIFACT_EXPORTED_KEYS,
  "lineCount",
  "textSha256",
];

const ARTIFACT_DATA_PROFILED_KEYS = [
  ...ARTIFACT_EXPORTED_KEYS,
  "format",
  "rowCount",
  "columnCount",
  "truncated",
  "columnSetSha256",
  "sampleSha256",
];

const ARTIFACT_DRIFT_CHECKED_BASE_KEYS = [
  "planId",
  "artifactId",
  "planRevision",
  "status",
  "kind",
  "pathSha256",
  "expectedSha256",
  "result",
];

const ARTIFACT_DRIFT_CHECKED_OBSERVED_KEYS = [
  ...ARTIFACT_DRIFT_CHECKED_BASE_KEYS,
  "observedSha256",
  "sizeBytes",
];

const ARTIFACT_DIRECTORY_MANIFESTED_KEYS = [
  "planId",
  "artifactId",
  "planRevision",
  "status",
  "kind",
  "pathSha256",
  "sha256",
  "sizeBytes",
  "entryCount",
  "fileCount",
  "directoryCount",
];

export function isArtifactReceiptEvent(
  event: Pick<RunEvent, "type" | "category"> | Record<string, unknown>,
): boolean {
  return (
    event["category"] === "artifact" &&
    typeof event["type"] === "string" &&
    ARTIFACT_RECEIPT_EVENTS.has(event["type"])
  );
}

export function assertArtifactReceiptEventBoundary(
  event:
    | Pick<RunEvent, "type" | "category" | "payload">
    | Record<string, unknown>,
  label: string,
): void {
  if (!isArtifactReceiptEvent(event)) return;
  const payload = recordField(event["payload"], label);
  if (event["type"] === "artifact.data_profiled") {
    assertArtifactDataProfiledPayload(payload, label);
    return;
  }
  if (event["type"] === "artifact.directory_manifested") {
    assertArtifactDirectoryManifestedPayload(payload, label);
    return;
  }
  if (event["type"] === "artifact.drift_checked") {
    assertArtifactDriftCheckedPayload(payload, label);
    return;
  }
  const allowedKeys =
    event["type"] === "artifact.previewed"
      ? ARTIFACT_PREVIEWED_KEYS
      : ARTIFACT_EXPORTED_KEYS;
  assertExactKeys(payload, allowedKeys, label);
  assertNonEmptyString(payload["planId"], label);
  assertNonEmptyString(payload["artifactId"], label);
  assertSha256(payload["pathSha256"], label);
  assertSha256(payload["sha256"], label);
  assertNonNegativeInteger(payload["sizeBytes"], label);
  assertPositiveInteger(payload["planRevision"], label);
  if (payload["kind"] !== "file") {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
  if (payload["status"] !== "produced" && payload["status"] !== "verified") {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
  if (event["type"] === "artifact.previewed") {
    assertNonNegativeInteger(payload["lineCount"], label);
    assertSha256(payload["textSha256"], label);
  }
}

function assertArtifactDataProfiledPayload(
  payload: Record<string, unknown>,
  label: string,
): void {
  assertExactKeys(payload, ARTIFACT_DATA_PROFILED_KEYS, label);
  assertNonEmptyString(payload["planId"], label);
  assertNonEmptyString(payload["artifactId"], label);
  assertPositiveInteger(payload["planRevision"], label);
  if (payload["status"] !== "produced" && payload["status"] !== "verified") {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
  if (payload["kind"] !== "file") {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
  const format = payload["format"];
  if (
    format !== "json" &&
    format !== "jsonl" &&
    format !== "csv" &&
    format !== "tsv" &&
    format !== "markdown_table"
  ) {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
  if (typeof payload["truncated"] !== "boolean") {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
  assertSha256(payload["pathSha256"], label);
  assertSha256(payload["sha256"], label);
  assertSha256(payload["columnSetSha256"], label);
  assertSha256(payload["sampleSha256"], label);
  assertNonNegativeInteger(payload["sizeBytes"], label);
  assertNonNegativeInteger(payload["rowCount"], label);
  assertNonNegativeInteger(payload["columnCount"], label);
}

function assertArtifactDirectoryManifestedPayload(
  payload: Record<string, unknown>,
  label: string,
): void {
  assertExactKeys(payload, ARTIFACT_DIRECTORY_MANIFESTED_KEYS, label);
  assertNonEmptyString(payload["planId"], label);
  assertNonEmptyString(payload["artifactId"], label);
  assertPositiveInteger(payload["planRevision"], label);
  if (payload["status"] !== "produced" && payload["status"] !== "verified") {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
  if (payload["kind"] !== "directory") {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
  assertSha256(payload["pathSha256"], label);
  assertSha256(payload["sha256"], label);
  assertNonNegativeInteger(payload["sizeBytes"], label);
  assertPositiveInteger(payload["entryCount"], label);
  assertNonNegativeInteger(payload["fileCount"], label);
  assertPositiveInteger(payload["directoryCount"], label);
}

function assertArtifactDriftCheckedPayload(
  payload: Record<string, unknown>,
  label: string,
): void {
  const result = payload["result"];
  if (result !== "current" && result !== "drifted" && result !== "missing") {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
  assertExactKeys(
    payload,
    result === "missing"
      ? ARTIFACT_DRIFT_CHECKED_BASE_KEYS
      : ARTIFACT_DRIFT_CHECKED_OBSERVED_KEYS,
    label,
  );
  assertNonEmptyString(payload["planId"], label);
  assertNonEmptyString(payload["artifactId"], label);
  assertPositiveInteger(payload["planRevision"], label);
  if (payload["status"] !== "verified") {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
  if (payload["kind"] !== "file" && payload["kind"] !== "directory") {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
  assertSha256(payload["pathSha256"], label);
  assertSha256(payload["expectedSha256"], label);
  if (result !== "missing") {
    assertSha256(payload["observedSha256"], label);
    assertNonNegativeInteger(payload["sizeBytes"], label);
  }
}

function assertExactKeys(
  payload: Record<string, unknown>,
  allowedKeys: string[],
  label: string,
): void {
  if (
    Object.keys(payload).some((key) => !allowedKeys.includes(key)) ||
    allowedKeys.some((key) => !(key in payload))
  ) {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
}

function recordField(value: unknown, label: string): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
  return value as Record<string, unknown>;
}

function assertNonEmptyString(value: unknown, label: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
}

function assertSha256(value: unknown, label: string): void {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
}

function assertPositiveInteger(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
}

function assertNonNegativeInteger(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
}
