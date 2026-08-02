import type { RunStatus } from "@napier/contracts";

import type {
  CodingBenchmarkLedgerBundle,
  CodingBenchmarkResult,
  CodingBenchmarkToolMetrics,
} from "./coding-benchmark-types.js";
import { validCodingBenchmarkEvaluationShape } from "./coding-benchmark-evaluation-shape.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;
const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const TERMINAL_RUN_STATUSES = new Set<RunStatus>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
const RESULT_KEYS = keySet(
  "kind schemaVersion generatedAt caseId caseSha256 status model environment run tooling evaluation ledger contentSha256",
);
const BUNDLE_KEYS = keySet(
  "kind schemaVersion generatedAt caseId caseSha256 threadId run tooling evaluationEvent eventCount retainedEventCount omittedEventCount eventTypeCounts eventTypeSetSha256 sourceEventStreamSha256 sourceSnapshotSha256 eventReceipts receiptSetSha256 contentSha256",
);
const TOOLING_V1_KEYS = keySet(
  "started completed failed blocked repeatedCallCount applyPatchCompleted",
);
const TOOLING_V2_KEYS = [...TOOLING_V1_KEYS, "toolOutcomes"] as const;
const TOOLING_COUNT_KEYS = keySet(
  "started completed failed blocked repeatedCallCount",
);
const TOOL_OUTCOME_KEYS = keySet(
  "toolName started completed failed blocked repeatedCallCount",
);
const ENVIRONMENT_KEYS = keySet("nodeVersion platform arch cliVersion");
const RESULT_RUN_KEYS = keySet(
  "threadId runId status agentId agentRevision configurationSha256 durationMs usage",
);
const BUNDLE_RUN_KEYS = keySet(
  "id agentId agentRevision status model configurationSha256 durationMs usage",
);
const RESULT_LEDGER_KEYS = keySet(
  "eventId eventSeq eventSha256 eventStreamSha256 bundleFileName bundleSha256 bundleBytes",
);
const EVALUATION_EVENT_KEYS = keySet(
  "id threadId runId seq type category visibility createdAt payload",
);
const USAGE_KEYS = keySet(
  "inputTokens outputTokens cacheReadTokens cacheWriteTokens costUsd",
);
const RECEIPT_KEYS = keySet(
  "id seq runId type category visibility createdAt payloadSha256 previousReceiptSha256 receiptSha256",
);

export function validCodingBenchmarkResultShape(
  value: unknown,
): value is CodingBenchmarkResult {
  if (!exactRecord(value, RESULT_KEYS)) return false;
  const schemaVersion = value["schemaVersion"];
  return (
    value["kind"] === "napier.coding-benchmark-result" &&
    (schemaVersion === 1 || schemaVersion === 2) &&
    validIsoDate(value["generatedAt"]) &&
    resourceId(value["caseId"]) &&
    isSha256(value["caseSha256"]) &&
    (value["status"] === "passed" ||
      value["status"] === "failed" ||
      value["status"] === "inconclusive") &&
    validModel(value["model"]) &&
    validEnvironment(value["environment"]) &&
    validResultRun(value["run"]) &&
    validCodingBenchmarkToolMetricsShape(value["tooling"], schemaVersion) &&
    validCodingBenchmarkEvaluationShape(value["evaluation"]) &&
    validResultLedger(value["ledger"]) &&
    isSha256(value["contentSha256"])
  );
}

export function validCodingBenchmarkLedgerBundleShape(
  value: unknown,
): value is CodingBenchmarkLedgerBundle {
  if (!exactRecord(value, BUNDLE_KEYS)) return false;
  const schemaVersion = value["schemaVersion"];
  return (
    value["kind"] === "napier.coding-benchmark-ledger" &&
    (schemaVersion === 1 || schemaVersion === 2) &&
    validIsoDate(value["generatedAt"]) &&
    resourceId(value["caseId"]) &&
    isSha256(value["caseSha256"]) &&
    resourceId(value["threadId"]) &&
    validBundleRun(value["run"]) &&
    validCodingBenchmarkToolMetricsShape(value["tooling"], schemaVersion) &&
    validEvaluationEvent(value["evaluationEvent"]) &&
    nonNegativeInteger(value["eventCount"]) &&
    Number(value["eventCount"]) >= 1 &&
    nonNegativeInteger(value["retainedEventCount"]) &&
    nonNegativeInteger(value["omittedEventCount"]) &&
    validEventTypeCounts(value["eventTypeCounts"]) &&
    isSha256(value["eventTypeSetSha256"]) &&
    isSha256(value["sourceEventStreamSha256"]) &&
    isSha256(value["sourceSnapshotSha256"]) &&
    Array.isArray(value["eventReceipts"]) &&
    value["eventReceipts"].every(validEventReceipt) &&
    isSha256(value["receiptSetSha256"]) &&
    isSha256(value["contentSha256"])
  );
}

export function validCodingBenchmarkToolMetricsShape(
  value: unknown,
  schemaVersion?: 1 | 2,
): value is CodingBenchmarkToolMetrics {
  const observedVersion =
    schemaVersion ??
    (recordHasOwn(value, "toolOutcomes") ? (2 as const) : (1 as const));
  if (
    !exactRecord(
      value,
      observedVersion === 2 ? TOOLING_V2_KEYS : TOOLING_V1_KEYS,
    )
  ) {
    return false;
  }
  const countsValid = TOOLING_COUNT_KEYS.every((key) =>
    nonNegativeInteger(value[key]),
  );
  if (
    !countsValid ||
    typeof value["applyPatchCompleted"] !== "boolean" ||
    Number(value["repeatedCallCount"]) > Number(value["started"])
  ) {
    return false;
  }
  if (observedVersion === 1) return true;
  const outcomes = value["toolOutcomes"];
  if (
    !Array.isArray(outcomes) ||
    outcomes.length > 64 ||
    !outcomes.every(validToolOutcome)
  ) {
    return false;
  }
  const names = outcomes.map((outcome) => String(outcome["toolName"]));
  return (
    new Set(names).size === names.length &&
    JSON.stringify(names) ===
      JSON.stringify(
        [...names].sort((left, right) => left.localeCompare(right)),
      ) &&
    TOOLING_COUNT_KEYS.every(
      (key) =>
        outcomes.reduce((total, outcome) => total + Number(outcome[key]), 0) ===
        Number(value[key]),
    ) &&
    value["applyPatchCompleted"] ===
      outcomes.some(
        (outcome) =>
          outcome["toolName"] === "apply_patch" &&
          Number(outcome["completed"]) > 0,
      )
  );
}

function validToolOutcome(value: unknown): value is Record<string, unknown> {
  return (
    exactRecord(value, TOOL_OUTCOME_KEYS) &&
    boundedText(value["toolName"], 1, 80) &&
    /^[a-z][a-z0-9_.-]{0,79}$/u.test(String(value["toolName"])) &&
    TOOLING_COUNT_KEYS.every((key) => nonNegativeInteger(value[key])) &&
    Number(value["repeatedCallCount"]) <= Number(value["started"])
  );
}

function validEnvironment(value: unknown): boolean {
  return (
    exactRecord(value, ENVIRONMENT_KEYS) &&
    boundedText(value["nodeVersion"], 1, 64) &&
    boundedText(value["platform"], 1, 32) &&
    boundedText(value["arch"], 1, 32) &&
    boundedText(value["cliVersion"], 1, 64)
  );
}

function validResultRun(value: unknown): boolean {
  return (
    exactRecord(value, RESULT_RUN_KEYS) &&
    resourceId(value["threadId"]) &&
    resourceId(value["runId"]) &&
    terminalRunStatus(value["status"]) &&
    resourceId(value["agentId"]) &&
    positiveInteger(value["agentRevision"]) &&
    isSha256(value["configurationSha256"]) &&
    nonNegativeNumber(value["durationMs"]) &&
    validUsage(value["usage"])
  );
}

function validBundleRun(value: unknown): boolean {
  return (
    exactRecord(value, BUNDLE_RUN_KEYS) &&
    resourceId(value["id"]) &&
    resourceId(value["agentId"]) &&
    positiveInteger(value["agentRevision"]) &&
    terminalRunStatus(value["status"]) &&
    validModel(value["model"]) &&
    isSha256(value["configurationSha256"]) &&
    nonNegativeNumber(value["durationMs"]) &&
    validUsage(value["usage"])
  );
}

function validResultLedger(value: unknown): boolean {
  return (
    exactRecord(value, RESULT_LEDGER_KEYS) &&
    resourceId(value["eventId"]) &&
    positiveInteger(value["eventSeq"]) &&
    isSha256(value["eventSha256"]) &&
    isSha256(value["eventStreamSha256"]) &&
    boundedText(value["bundleFileName"], 1, 255) &&
    !String(value["bundleFileName"]).includes("/") &&
    !String(value["bundleFileName"]).includes("\\") &&
    isSha256(value["bundleSha256"]) &&
    positiveInteger(value["bundleBytes"])
  );
}

function validEvaluationEvent(value: unknown): boolean {
  return (
    exactRecord(value, EVALUATION_EVENT_KEYS) &&
    resourceId(value["id"]) &&
    resourceId(value["threadId"]) &&
    resourceId(value["runId"]) &&
    positiveInteger(value["seq"]) &&
    value["type"] === "benchmark.evaluated" &&
    value["category"] === "evaluation" &&
    value["visibility"] === "user" &&
    validIsoDate(value["createdAt"]) &&
    validCodingBenchmarkEvaluationShape(value["payload"])
  );
}

function validEventTypeCounts(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  const types: string[] = [];
  for (const entry of value) {
    if (
      !exactRecord(entry, ["type", "count"]) ||
      !boundedText(entry["type"], 1, 160) ||
      !positiveInteger(entry["count"])
    ) {
      return false;
    }
    types.push(entry["type"]);
  }
  return (
    new Set(types).size === types.length &&
    JSON.stringify(types) ===
      JSON.stringify(
        [...types].sort((left, right) => left.localeCompare(right)),
      )
  );
}

function validEventReceipt(value: unknown): boolean {
  return (
    exactRecord(value, RECEIPT_KEYS) &&
    resourceId(value["id"]) &&
    positiveInteger(value["seq"]) &&
    resourceId(value["runId"]) &&
    boundedText(value["type"], 1, 160) &&
    boundedText(value["category"], 1, 64) &&
    boundedText(value["visibility"], 1, 64) &&
    validIsoDate(value["createdAt"]) &&
    isSha256(value["payloadSha256"]) &&
    (value["previousReceiptSha256"] === "" ||
      isSha256(value["previousReceiptSha256"])) &&
    isSha256(value["receiptSha256"])
  );
}

function validModel(value: unknown): boolean {
  return (
    exactRecord(value, ["provider", "id"]) &&
    typeof value["provider"] === "string" &&
    PROVIDER_ID.test(value["provider"]) &&
    typeof value["id"] === "string" &&
    MODEL_ID.test(value["id"])
  );
}

function validUsage(value: unknown): boolean {
  return (
    exactRecord(value, USAGE_KEYS) &&
    USAGE_KEYS.every((key) => nonNegativeNumber(value[key]))
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

function keySet(value: string): readonly string[] {
  return value.split(" ");
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && RESOURCE_ID.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function terminalRunStatus(value: unknown): value is RunStatus {
  return (
    typeof value === "string" && TERMINAL_RUN_STATUSES.has(value as RunStatus)
  );
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= minimum &&
    value.length <= maximum
  );
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordHasOwn(value: unknown, key: string): boolean {
  return record(value) && Object.hasOwn(value, key);
}
