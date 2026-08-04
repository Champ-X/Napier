import type { RunEvent } from "@napier/contracts";

import type { ResearchBenchmarkLedgerBundle } from "./research-benchmark-types.js";

const TOP_LEVEL_KEYS = keySet(
  "kind schemaVersion generatedAt caseId caseSha256 threadId run expectedClaimsSha256 actualClaimsSha256 contradictionClaimSha256 expectedCitationEvidenceSha256 expectedSourceSetSha256 sourceAuthorities report evaluationEvent terminalEvent researchEvents eventCount retainedEventCount omittedEventCount eventTypeCounts eventTypeSetSha256 sourceEventStreamSha256 sourceReplaySha256 eventReceipts receiptSetSha256 contentSha256",
);
const EVENT_KEYS = keySet(
  "id threadId runId seq type category visibility createdAt payload",
);
const RECEIPT_KEYS = keySet(
  "id seq runId type category visibility createdAt payloadSha256 previousReceiptSha256 receiptSha256",
);
const TOOL_PAYLOAD_KEYS = keySet(
  "callId toolName status outputTextSha256 outputTextBytes outputSha256 outputBytes outputRedacted resultSha256 details",
);
const CAPTURE_DETAILS_KEYS = keySet(
  "kind schemaVersion action sourceKind sourceId sourceContentSha256 sourceUrlSha256 sourceOriginSha256 sourceTitleSha256 sourceTextSha256 sourceLineCount sourceTextChars sourceTruncated sourceCount citationCount sourceSetSha256 browserSessionOperation browserSessionIdSha256 browserExecutableSha256 browserVersionSha256 browserLimitsSha256 browserNetworkDestinationsSha256",
);
const CITE_DETAILS_KEYS = [
  ...CAPTURE_DETAILS_KEYS,
  "citationId",
  "citationTokenSha256",
  "citationStartLine",
  "citationEndLine",
  "citationQuoteSha256",
  "citationClaimSha256",
];
const VERIFY_DETAILS_KEYS = keySet(
  "kind schemaVersion action sourceCount citationCount sourceSetSha256 reportPathSha256 reportFileSha256 reportFileBytes reportCitationCount reportCitationSetSha256",
);

export function validResearchBenchmarkLedgerShape(
  value: unknown,
): value is ResearchBenchmarkLedgerBundle {
  return researchBenchmarkLedgerShapeDiagnostics(value).length === 0;
}

export function researchBenchmarkLedgerShapeDiagnostics(
  value: unknown,
): string[] {
  const diagnostics: string[] = [];
  if (!record(value)) return ["record"];
  const keys =
    value["actualClaimsSha256"] === undefined
      ? TOP_LEVEL_KEYS.filter((key) => key !== "actualClaimsSha256")
      : TOP_LEVEL_KEYS;
  if (!exactRecord(value, keys)) diagnostics.push("top_level");
  if (!validBundleIdentity(value)) diagnostics.push("identity");
  if (!validEvent(value["evaluationEvent"])) diagnostics.push("evaluation");
  if (!validEvent(value["terminalEvent"])) diagnostics.push("terminal");
  if (!Array.isArray(value["researchEvents"])) {
    diagnostics.push("research_events");
  } else {
    value["researchEvents"].forEach((event, index) => {
      if (!validResearchEvent(event)) {
        diagnostics.push(`research_event_${String(index + 1)}`);
      }
    });
  }
  if (!validBundleEvidence(value)) diagnostics.push("evidence");
  return diagnostics;
}

function validBundleIdentity(value: Record<string, unknown>): boolean {
  return (
    value["kind"] === "napier.research-benchmark-ledger" &&
    value["schemaVersion"] === 1 &&
    validIsoDate(value["generatedAt"]) &&
    resourceId(value["caseId"]) &&
    digest(value["caseSha256"]) &&
    resourceId(value["threadId"]) &&
    validRun(value["run"]) &&
    digest(value["expectedClaimsSha256"]) &&
    optionalDigest(value["actualClaimsSha256"]) &&
    digest(value["contradictionClaimSha256"]) &&
    digest(value["expectedCitationEvidenceSha256"]) &&
    digest(value["expectedSourceSetSha256"]) &&
    validAuthorities(value["sourceAuthorities"]) &&
    validReport(value["report"])
  );
}

function validBundleEvidence(value: Record<string, unknown>): boolean {
  return (
    validEvent(value["evaluationEvent"]) &&
    validEvent(value["terminalEvent"]) &&
    Array.isArray(value["researchEvents"]) &&
    value["researchEvents"].every(validResearchEvent) &&
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
    ["completed", "failed", "cancelled", "interrupted", "running"].includes(
      String(value["status"]),
    ) &&
    nonNegativeInteger(value["durationMs"]) &&
    validUsage(value["usage"])
  );
}

function validReport(value: unknown): boolean {
  if (!record(value)) return false;
  const keys =
    value["fileSha256"] === undefined
      ? ["pathSha256", "fileBytes"]
      : ["pathSha256", "fileSha256", "fileBytes"];
  return (
    exactRecord(value, keys) &&
    digest(value["pathSha256"]) &&
    optionalDigest(value["fileSha256"]) &&
    nonNegativeInteger(value["fileBytes"])
  );
}

function validAuthorities(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (source) =>
        exactRecord(source, ["sourceContentSha256", "authority"]) &&
        digest(source["sourceContentSha256"]) &&
        (source["authority"] === "primary" ||
          source["authority"] === "secondary"),
    ) &&
    new Set(value.map((source) => source.sourceContentSha256)).size === 3
  );
}

function validResearchEvent(value: unknown): boolean {
  if (!validEvent(value) || value.type !== "tool.completed") return false;
  if (
    !exactRecord(value.payload, TOOL_PAYLOAD_KEYS) ||
    value.payload["toolName"] !== "research_source" ||
    value.payload["status"] !== "completed" ||
    typeof value.payload["callId"] !== "string" ||
    value.payload["callId"].length < 1 ||
    value.payload["callId"].length > 200 ||
    !digest(value.payload["outputTextSha256"]) ||
    !nonNegativeInteger(value.payload["outputTextBytes"]) ||
    !digest(value.payload["outputSha256"]) ||
    !nonNegativeInteger(value.payload["outputBytes"]) ||
    value.payload["outputRedacted"] !== true ||
    !digest(value.payload["resultSha256"])
  ) {
    return false;
  }
  return validResearchDetails(value.payload["details"]);
}

function validResearchDetails(value: unknown): boolean {
  if (!record(value) || !validResearchDetailsBase(value)) return false;
  if (value["action"] === "verify_report") {
    return validReportVerificationDetails(value);
  }
  if (!validCapturedSourceDetails(value)) return false;
  return value["action"] === "capture" || validCitationDetails(value);
}

function validResearchDetailsBase(value: Record<string, unknown>): boolean {
  return (
    value["kind"] === "napier.research-source" &&
    value["schemaVersion"] === 1 &&
    ["capture", "cite", "verify_report"].includes(String(value["action"])) &&
    nonNegativeInteger(value["sourceCount"]) &&
    nonNegativeInteger(value["citationCount"]) &&
    digest(value["sourceSetSha256"])
  );
}

function validReportVerificationDetails(
  value: Record<string, unknown>,
): boolean {
  return (
    exactKeys(value, VERIFY_DETAILS_KEYS) &&
    digest(value["reportPathSha256"]) &&
    digest(value["reportFileSha256"]) &&
    nonNegativeInteger(value["reportFileBytes"]) &&
    nonNegativeInteger(value["reportCitationCount"]) &&
    digest(value["reportCitationSetSha256"])
  );
}

function validCapturedSourceDetails(value: Record<string, unknown>): boolean {
  const keys =
    value["action"] === "capture" ? CAPTURE_DETAILS_KEYS : CITE_DETAILS_KEYS;
  return (
    exactKeys(value, keys) &&
    value["sourceKind"] === "browser" &&
    resourceId(value["sourceId"]) &&
    digest(value["sourceContentSha256"]) &&
    digest(value["sourceUrlSha256"]) &&
    digest(value["sourceOriginSha256"]) &&
    digest(value["sourceTitleSha256"]) &&
    digest(value["sourceTextSha256"]) &&
    nonNegativeInteger(value["sourceLineCount"]) &&
    nonNegativeInteger(value["sourceTextChars"]) &&
    typeof value["sourceTruncated"] === "boolean" &&
    nonNegativeInteger(value["browserSessionOperation"]) &&
    digest(value["browserSessionIdSha256"]) &&
    digest(value["browserExecutableSha256"]) &&
    digest(value["browserVersionSha256"]) &&
    digest(value["browserLimitsSha256"]) &&
    digest(value["browserNetworkDestinationsSha256"])
  );
}

function validCitationDetails(value: Record<string, unknown>): boolean {
  return (
    resourceId(value["citationId"]) &&
    digest(value["citationTokenSha256"]) &&
    nonNegativeInteger(value["citationStartLine"]) &&
    nonNegativeInteger(value["citationEndLine"]) &&
    digest(value["citationQuoteSha256"]) &&
    digest(value["citationClaimSha256"])
  );
}

function validEvent(value: unknown): value is RunEvent {
  return (
    exactRecord(value, EVENT_KEYS) &&
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

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort())
  );
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return record(value) && exactKeys(value, keys);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function optionalDigest(value: unknown): boolean {
  return value === undefined || digest(value);
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function validIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function keySet(value: string): readonly string[] {
  return value.split(" ");
}
