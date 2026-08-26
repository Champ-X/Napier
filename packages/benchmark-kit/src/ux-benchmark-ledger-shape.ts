import type { RunEvent } from "@napier/contracts";

import type { UxBenchmarkLedgerBundle } from "./ux-benchmark-types.js";
import { hasExactRunEventEnvelope } from "./run-event-envelope-shape.js";

const TOP_LEVEL_KEYS = keySet(
  "kind schemaVersion generatedAt caseId caseSha256 threadId model environment run expectedOutputSha256 actualOutputSha256 credentialVariableSha256 cliExitCode manualCommandCount firstEventMs maxFirstEventMs totalDurationMs maxDurationMs credentialReferenceCount credentialProviderMatch credentialLocatorMatch credentialAvailable threadCountAfter replayValid credentialLeakDetected credentialPersistenceLeakDetected evaluationEvent terminalEvent eventCount retainedEventCount omittedEventCount eventTypeCounts eventTypeSetSha256 sourceEventStreamSha256 sourceReplaySha256 eventReceipts receiptSetSha256 contentSha256",
);
const RECEIPT_KEYS = keySet(
  "id seq runId type category visibility createdAt payloadSha256 previousReceiptSha256 receiptSha256",
);

export function validUxBenchmarkLedgerShape(
  value: unknown,
): value is UxBenchmarkLedgerBundle {
  if (!record(value)) return false;
  const keys =
    value["actualOutputSha256"] === undefined
      ? TOP_LEVEL_KEYS.filter((key) => key !== "actualOutputSha256")
      : TOP_LEVEL_KEYS;
  return (
    exactRecord(value, keys) &&
    validIdentity(value) &&
    validOutcomeEvidence(value) &&
    validEventEvidence(value)
  );
}

function validIdentity(value: Record<string, unknown>): boolean {
  return (
    value["kind"] === "napier.ux-benchmark-ledger" &&
    value["schemaVersion"] === 1 &&
    validIsoDate(value["generatedAt"]) &&
    resourceId(value["caseId"]) &&
    digest(value["caseSha256"]) &&
    resourceId(value["threadId"]) &&
    validModel(value["model"]) &&
    validEnvironment(value["environment"]) &&
    validRun(value["run"])
  );
}

function validOutcomeEvidence(value: Record<string, unknown>): boolean {
  return (
    digest(value["expectedOutputSha256"]) &&
    optionalDigest(value["actualOutputSha256"]) &&
    digest(value["credentialVariableSha256"]) &&
    [
      "cliExitCode",
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
    ].every((key) => typeof value[key] === "boolean")
  );
}

function validEventEvidence(value: Record<string, unknown>): boolean {
  return (
    validEvent(value["evaluationEvent"]) &&
    validTerminalEvent(value["terminalEvent"]) &&
    nonNegativeInteger(value["eventCount"]) &&
    nonNegativeInteger(value["retainedEventCount"]) &&
    nonNegativeInteger(value["omittedEventCount"]) &&
    validEventTypeCounts(value["eventTypeCounts"]) &&
    digest(value["eventTypeSetSha256"]) &&
    digest(value["sourceEventStreamSha256"]) &&
    digest(value["sourceReplaySha256"]) &&
    Array.isArray(value["eventReceipts"]) &&
    value["eventReceipts"].every(validReceipt) &&
    digest(value["receiptSetSha256"]) &&
    digest(value["contentSha256"])
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

function validTerminalEvent(value: unknown): boolean {
  return (
    validEvent(value) &&
    ["run.completed", "run.failed", "run.cancelled"].includes(value.type)
  );
}

function validEvent(value: unknown): value is RunEvent {
  return (
    hasExactRunEventEnvelope(value) &&
    resourceId(value["id"]) &&
    resourceId(value["threadId"]) &&
    resourceId(value["runId"]) &&
    positiveInteger(value["seq"]) &&
    typeof value["type"] === "string" &&
    typeof value["category"] === "string" &&
    typeof value["visibility"] === "string" &&
    validIsoDate(value["createdAt"]) &&
    value["payload"] !== undefined
  );
}

function validReceipt(value: unknown): boolean {
  return (
    exactRecord(value, RECEIPT_KEYS) &&
    resourceId(value["id"]) &&
    positiveInteger(value["seq"]) &&
    resourceId(value["runId"]) &&
    typeof value["type"] === "string" &&
    typeof value["category"] === "string" &&
    typeof value["visibility"] === "string" &&
    validIsoDate(value["createdAt"]) &&
    digest(value["payloadSha256"]) &&
    digest(value["previousReceiptSha256"]) &&
    digest(value["receiptSha256"])
  );
}

function validEventTypeCounts(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        exactRecord(entry, ["type", "count"]) &&
        typeof entry["type"] === "string" &&
        positiveInteger(entry["count"]),
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

function runStatus(value: unknown): boolean {
  return [
    "running",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ].includes(String(value));
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
