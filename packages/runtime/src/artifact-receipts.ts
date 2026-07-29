import type { RunEvent } from "@napier/contracts";

const SHA256 = /^[a-f0-9]{64}$/;
const ARTIFACT_RECEIPT_EVENTS = new Set([
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
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
}

function assertNonNegativeInteger(value: unknown, label: string): void {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(`${label} hash-only artifact receipt is invalid`);
  }
}
