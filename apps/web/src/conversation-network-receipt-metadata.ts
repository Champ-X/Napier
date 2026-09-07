import type { RunEvent } from "@napier/contracts";
import type { ToolFailureClassV1 } from "@napier/contracts/tool-protocol";

export type NetworkFailureClass = ToolFailureClassV1 | "circuit_open";

const FAILURE_CLASSES = new Set<ToolFailureClassV1>([
  "invalid_input",
  "unavailable",
  "unsupported",
  "unauthorized",
  "forbidden",
  "not_found",
  "rate_limited",
  "timeout",
  "network",
  "session_state",
  "cancelled",
  "policy",
  "resource_limit",
  "unknown",
]);
const SCOPES = new Set([
  "invocation",
  "target",
  "origin",
  "route",
  "capability",
  "session",
]);
const DISPOSITIONS = new Set([
  "correct_input",
  "alternate_route",
  "retry_after",
  "recover_state",
  "terminal",
]);
const JOURNAL_KEYS = [
  "operationJournalVersion",
  "operationCount",
  "settledOperationCount",
  "operationSetSha256",
];
const HASH = /^[a-f0-9]{64}$/u;

// Summaries use typed, hash-only receipts. Never infer a cause from raw tool text.
export function networkFailureClass(
  value: unknown,
): ToolFailureClassV1 | undefined {
  const failure = record(value);
  if (
    failure?.["kind"] !== "napier.tool-failure-semantics" ||
    failure["schemaVersion"] !== 1 ||
    !["trusted_declared", "legacy_fallback"].includes(
      String(failure["coverage"]),
    ) ||
    !FAILURE_CLASSES.has(failure["class"] as ToolFailureClassV1) ||
    !SCOPES.has(String(failure["scope"])) ||
    !DISPOSITIONS.has(String(failure["disposition"])) ||
    typeof failure["fatalToSession"] !== "boolean" ||
    !hash(failure["failureDefinitionSha256"]) ||
    !hash(failure["diagnosticSha256"])
  )
    return undefined;
  return failure["class"] as ToolFailureClassV1;
}

export function networkCircuitRejectionKey(
  event: RunEvent,
): string | undefined {
  if (event.type !== "tool.operation.admitted") return undefined;
  const payload = record(event.payload);
  const callId = payload?.["parentCallId"];
  if (
    payload?.["kind"] !== "napier.tool-operation" ||
    payload["schemaVersion"] !== 1 ||
    payload["admission"] !== "rejected" ||
    payload["admissionSource"] !== "failure_circuit" ||
    payload["circuitStatus"] !== "open" ||
    !hash(payload["circuitKeySha256"]) ||
    !hash(payload["circuitPolicySha256"]) ||
    typeof callId !== "string" ||
    !/^[A-Za-z0-9_.:-]{1,160}$/u.test(callId)
  )
    return undefined;
  return `${event.runId}\0${callId}`;
}

export function validSearchReceiptMetadata(
  details: Record<string, unknown>,
): boolean {
  if (JOURNAL_KEYS.some((key) => key in details)) {
    const count = details["operationCount"];
    const settled = details["settledOperationCount"];
    if (
      details["operationJournalVersion"] !== 1 ||
      !Number.isSafeInteger(count) ||
      Number(count) < 0 ||
      !Number.isSafeInteger(settled) ||
      Number(settled) < 0 ||
      Number(settled) !== Number(count) ||
      !hash(details["operationSetSha256"])
    )
      return false;
  }
  if ("resolvedCategory" in details || "resolutionMode" in details) {
    return (
      details["category"] === "images" &&
      details["resolvedCategory"] === "general" &&
      details["resolutionMode"] === "image_page_candidates"
    );
  }
  return true;
}

function hash(value: unknown): boolean {
  return typeof value === "string" && HASH.test(value);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
