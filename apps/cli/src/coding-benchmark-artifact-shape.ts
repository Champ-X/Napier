import type { RunStatus } from "@napier/contracts";

import type {
  CodingBenchmarkEvaluation,
  CodingBenchmarkLedgerBundle,
  CodingBenchmarkResult,
  CodingBenchmarkToolMetrics,
} from "./coding-benchmark-types.js";

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
const EVALUATION_DIAGNOSTICS = new Set([
  "run_not_completed",
  "workspace_snapshot_truncated",
  "target_mismatch",
  "expected_change_missing",
  "unexpected_workspace_changes",
]);

const RESULT_KEYS = keySet(
  "kind schemaVersion generatedAt caseId caseSha256 status model environment run tooling evaluation ledger contentSha256",
);
const BUNDLE_KEYS = keySet(
  "kind schemaVersion generatedAt caseId caseSha256 threadId run tooling evaluationEvent eventCount retainedEventCount omittedEventCount eventTypeCounts eventTypeSetSha256 sourceEventStreamSha256 sourceSnapshotSha256 eventReceipts receiptSetSha256 contentSha256",
);
const EVALUATION_KEYS = keySet(
  "kind schemaVersion caseId caseSha256 status runStatus criteriaSha256 workspaceBeforeSha256 workspaceAfterSha256 targetBeforeSha256 targetAfterSha256 expectedTargetSha256 targetAfterAstSha256 expectedTargetAstSha256 changedFileCount changedPathSetSha256 targetSemanticMatch allowedChangeSetMatch diagnostics contentSha256",
);
const TOOLING_KEYS = keySet(
  "started completed failed blocked repeatedCallCount applyPatchCompleted",
);
const TOOLING_COUNT_KEYS = keySet(
  "started completed failed blocked repeatedCallCount",
);
const EVALUATION_SHA256_KEYS = keySet(
  "criteriaSha256 workspaceBeforeSha256 workspaceAfterSha256 targetBeforeSha256 targetAfterSha256 expectedTargetSha256 targetAfterAstSha256 expectedTargetAstSha256 changedPathSetSha256 contentSha256",
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
  return (
    value["kind"] === "napier.coding-benchmark-result" &&
    value["schemaVersion"] === 1 &&
    validIsoDate(value["generatedAt"]) &&
    resourceId(value["caseId"]) &&
    isSha256(value["caseSha256"]) &&
    (value["status"] === "passed" || value["status"] === "failed") &&
    validModel(value["model"]) &&
    validEnvironment(value["environment"]) &&
    validResultRun(value["run"]) &&
    validCodingBenchmarkToolMetricsShape(value["tooling"]) &&
    validEvaluation(value["evaluation"]) &&
    validResultLedger(value["ledger"]) &&
    isSha256(value["contentSha256"])
  );
}

export function validCodingBenchmarkLedgerBundleShape(
  value: unknown,
): value is CodingBenchmarkLedgerBundle {
  if (!exactRecord(value, BUNDLE_KEYS)) return false;
  return (
    value["kind"] === "napier.coding-benchmark-ledger" &&
    value["schemaVersion"] === 1 &&
    validIsoDate(value["generatedAt"]) &&
    resourceId(value["caseId"]) &&
    isSha256(value["caseSha256"]) &&
    resourceId(value["threadId"]) &&
    validBundleRun(value["run"]) &&
    validCodingBenchmarkToolMetricsShape(value["tooling"]) &&
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
): value is CodingBenchmarkToolMetrics {
  if (!exactRecord(value, TOOLING_KEYS)) return false;
  return (
    TOOLING_COUNT_KEYS.every((key) => nonNegativeInteger(value[key])) &&
    typeof value["applyPatchCompleted"] === "boolean"
  );
}

function validEvaluation(value: unknown): value is CodingBenchmarkEvaluation {
  if (!exactRecord(value, EVALUATION_KEYS)) return false;
  const diagnostics = value["diagnostics"];
  return (
    value["kind"] === "napier.coding-benchmark-evaluation" &&
    value["schemaVersion"] === 1 &&
    resourceId(value["caseId"]) &&
    isSha256(value["caseSha256"]) &&
    (value["status"] === "passed" || value["status"] === "failed") &&
    terminalRunStatus(value["runStatus"]) &&
    EVALUATION_SHA256_KEYS.every((key) => isSha256(value[key])) &&
    nonNegativeInteger(value["changedFileCount"]) &&
    typeof value["targetSemanticMatch"] === "boolean" &&
    typeof value["allowedChangeSetMatch"] === "boolean" &&
    Array.isArray(diagnostics) &&
    diagnostics.length <= EVALUATION_DIAGNOSTICS.size &&
    new Set(diagnostics).size === diagnostics.length &&
    diagnostics.every(
      (diagnostic) =>
        typeof diagnostic === "string" &&
        EVALUATION_DIAGNOSTICS.has(diagnostic),
    ) &&
    (value["status"] === "passed") === (diagnostics.length === 0) &&
    (value["status"] !== "passed" ||
      (value["runStatus"] === "completed" &&
        value["targetSemanticMatch"] === true &&
        value["allowedChangeSetMatch"] === true &&
        Number(value["changedFileCount"]) >= 1))
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
    validEvaluation(value["payload"])
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
