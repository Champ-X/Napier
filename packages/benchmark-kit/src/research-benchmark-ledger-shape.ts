import type { RunEvent } from "@napier/contracts";
import { parseResearchSourceEvidenceV1 } from "@napier/contracts/skill-load";

import type { ResearchBenchmarkLedgerBundle } from "./research-benchmark-types.js";
import { hasExactRunEventEnvelope } from "./run-event-envelope-shape.js";
import { validCompletedToolProtocolProjection } from "./tool-protocol-event-shape.js";

const TOP_LEVEL_KEYS = keySet(
  "kind schemaVersion generatedAt caseId caseSha256 threadId run expectedClaimsSha256 actualClaimsSha256 contradictionClaimSha256 expectedCitationEvidenceSha256 expectedSourceSetSha256 sourceAuthorities report evaluationEvent terminalEvent researchEvents eventCount retainedEventCount omittedEventCount eventTypeCounts eventTypeSetSha256 sourceEventStreamSha256 sourceReplaySha256 eventReceipts receiptSetSha256 contentSha256",
);
const RECEIPT_KEYS = keySet(
  "id seq runId type category visibility createdAt payloadSha256 previousReceiptSha256 receiptSha256",
);
const TOOL_PAYLOAD_KEYS = keySet(
  "callId toolName status outputTextSha256 outputTextBytes outputSha256 outputBytes outputRedacted resultSha256 details toolProtocol",
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
    !digest(value.payload["resultSha256"]) ||
    !validCompletedToolProtocolProjection(
      value.payload["toolProtocol"],
      "research_source",
    )
  ) {
    return false;
  }
  return validResearchDetails(value.payload["details"]);
}

function validResearchDetails(value: unknown): boolean {
  return (
    record(value) &&
    value["kind"] === "napier.research-source-evidence" &&
    parseResearchSourceEvidenceV1(value) !== undefined
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
