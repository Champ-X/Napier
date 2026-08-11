import type { JsonValue } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export function verificationToolCallArgumentsLedgerProjection(
  args: unknown,
): JsonValue {
  const value = record(args);
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    verificationKind:
      typeof value?.["kind"] === "string" ? value["kind"] : "unknown",
    cwdPathSha256: sha256(
      typeof value?.["cwd"] === "string" ? value["cwd"] : ".",
    ),
    targetPathSha256: sha256(
      typeof value?.["target"] === "string" ? value["target"] : "",
    ),
    timeoutMs:
      typeof value?.["timeoutMs"] === "number" ? value["timeoutMs"] : 60_000,
    inputSha256: verificationInputSha256(args),
  };
}

export function verificationToolInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  return {
    inputSha256: verificationInputSha256(args),
    inputRedacted: true,
  };
}

export function verificationToolOutputLedgerProjection(
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const details = record(record(result)?.["details"]);
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    ...(details ? { details: verificationDetailsProjection(details) } : {}),
  };
}

export function verificationDetailsProjection(
  value: Record<string, unknown>,
): Record<string, JsonValue> {
  const fields = [
    "kind",
    "status",
    "scopeSha256",
    "cwdPathSha256",
    "targetPathSha256",
    "targetKind",
    "targetSnapshotSha256",
    "targetSnapshotFileCount",
    "targetSnapshotBytes",
    "targetSnapshotTruncated",
    "verifierPathSha256",
    "verifierSha256",
    "verifierVersion",
    "toolchainExternal",
    "toolchainSha256",
    "runtimeIdentitySha256",
    "workspaceSnapshotSha256",
    "workspaceSnapshotFileCount",
    "workspaceSnapshotBytes",
    "workspaceSnapshotTruncated",
    "durationMs",
    "exitCode",
    "signal",
    "stdoutChars",
    "stderrChars",
    "stdoutSha256",
    "stderrSha256",
    "stdoutTruncated",
    "stderrTruncated",
    "resultSha256",
  ] as const;
  const projected: Record<string, JsonValue> = {
    sandboxSha256: sha256(
      typeof value["sandbox"] === "string" ? value["sandbox"] : "",
    ),
  };
  for (const field of fields) {
    const candidate = jsonScalar(value[field]);
    if (candidate !== undefined) projected[field] = candidate;
  }
  return projected;
}

function verificationInputSha256(args: unknown): string {
  return sha256(canonicalJson({ toolName: "verify_workspace", args }));
}

function jsonScalar(value: unknown): JsonValue | undefined {
  return value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
    ? value
    : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
