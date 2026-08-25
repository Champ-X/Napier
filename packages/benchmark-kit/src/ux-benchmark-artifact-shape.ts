import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import type {
  UxBenchmarkEvaluation,
  UxBenchmarkResult,
} from "./ux-benchmark-types.js";

const RESULT_KEYS = keySet(
  "kind schemaVersion generatedAt caseId caseSha256 status model environment run evaluation ledger contentSha256",
);
const EVALUATION_KEYS = keySet(
  "kind schemaVersion caseId caseSha256 status runStatus criteriaSha256 cliExitCode expectedOutputSha256 actualOutputSha256 outputMatch manualCommandCount firstEventMs maxFirstEventMs totalDurationMs maxDurationMs credentialReferenceCount credentialProviderMatch credentialLocatorMatch credentialAvailable threadCountAfter replayValid credentialLeakDetected credentialPersistenceLeakDetected diagnostics contentSha256",
);

export function validUxBenchmarkResultShape(
  value: unknown,
): value is UxBenchmarkResult {
  return (
    exactRecord(value, RESULT_KEYS) &&
    value["kind"] === "napier.ux-benchmark-result" &&
    value["schemaVersion"] === 1 &&
    validIsoDate(value["generatedAt"]) &&
    resourceId(value["caseId"]) &&
    digest(value["caseSha256"]) &&
    resultStatus(value["status"]) &&
    validModel(value["model"]) &&
    validEnvironment(value["environment"]) &&
    validRun(value["run"]) &&
    validEvaluation(value["evaluation"]) &&
    validLedger(value["ledger"]) &&
    digest(value["contentSha256"])
  );
}

function validEvaluation(value: unknown): value is UxBenchmarkEvaluation {
  if (!record(value)) return false;
  const keys =
    value["actualOutputSha256"] === undefined
      ? EVALUATION_KEYS.filter((key) => key !== "actualOutputSha256")
      : EVALUATION_KEYS;
  if (!exactRecord(value, keys)) return false;
  const { contentSha256, ...content } = value;
  return (
    value["kind"] === "napier.ux-benchmark-evaluation" &&
    value["schemaVersion"] === 1 &&
    resourceId(value["caseId"]) &&
    digest(value["caseSha256"]) &&
    resultStatus(value["status"]) &&
    runStatus(value["runStatus"]) &&
    digest(value["criteriaSha256"]) &&
    nonNegativeInteger(value["cliExitCode"]) &&
    digest(value["expectedOutputSha256"]) &&
    optionalDigest(value["actualOutputSha256"]) &&
    typeof value["outputMatch"] === "boolean" &&
    [
      "manualCommandCount",
      "firstEventMs",
      "maxFirstEventMs",
      "totalDurationMs",
      "maxDurationMs",
      "credentialReferenceCount",
      "threadCountAfter",
    ].every((key) => nonNegativeInteger(value[key])) &&
    [
      "credentialProviderMatch",
      "credentialLocatorMatch",
      "credentialAvailable",
      "replayValid",
      "credentialLeakDetected",
      "credentialPersistenceLeakDetected",
    ].every((key) => typeof value[key] === "boolean") &&
    Array.isArray(value["diagnostics"]) &&
    value["diagnostics"].every((item) => typeof item === "string") &&
    digest(contentSha256) &&
    sha256(canonicalJson(content as unknown as JsonValue)) === contentSha256
  );
}

function validRun(value: unknown): boolean {
  return (
    exactRecord(value, [
      "threadId",
      "runId",
      "status",
      "durationMs",
      "usage",
    ]) &&
    resourceId(value["threadId"]) &&
    resourceId(value["runId"]) &&
    runStatus(value["status"]) &&
    nonNegativeInteger(value["durationMs"]) &&
    validUsage(value["usage"])
  );
}

function validLedger(value: unknown): boolean {
  return (
    exactRecord(value, [
      "eventId",
      "eventSeq",
      "eventSha256",
      "eventStreamSha256",
      "bundleFileName",
      "bundleSha256",
      "bundleBytes",
    ]) &&
    resourceId(value["eventId"]) &&
    positiveInteger(value["eventSeq"]) &&
    digest(value["eventSha256"]) &&
    digest(value["eventStreamSha256"]) &&
    typeof value["bundleFileName"] === "string" &&
    /^napier-ux-benchmark-ledger-[a-z][a-z0-9_]{2,80}-[a-f0-9]{16}\.json$/u.test(
      value["bundleFileName"],
    ) &&
    digest(value["bundleSha256"]) &&
    positiveInteger(value["bundleBytes"])
  );
}

function validModel(value: unknown): boolean {
  return (
    exactRecord(value, ["provider", "id"]) &&
    typeof value["provider"] === "string" &&
    /^[a-z][a-z0-9_-]{0,63}$/u.test(value["provider"]) &&
    typeof value["id"] === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(value["id"])
  );
}

function validEnvironment(value: unknown): boolean {
  return (
    exactRecord(value, ["nodeVersion", "platform", "arch", "cliVersion"]) &&
    Object.values(value).every(
      (item) =>
        typeof item === "string" && item.length >= 1 && item.length <= 64,
    )
  );
}

function validUsage(value: unknown): boolean {
  return (
    exactRecord(value, [
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
      "costUsd",
    ]) &&
    Object.values(value).every(
      (item) => typeof item === "number" && Number.isFinite(item) && item >= 0,
    )
  );
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    record(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resultStatus(value: unknown): boolean {
  return ["passed", "failed", "inconclusive"].includes(String(value));
}

function runStatus(value: unknown): boolean {
  return [
    "running",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ].includes(String(value));
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function optionalDigest(value: unknown): boolean {
  return value === undefined || digest(value);
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function validIsoDate(value: unknown): boolean {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function keySet(value: string): readonly string[] {
  return value.split(" ");
}
