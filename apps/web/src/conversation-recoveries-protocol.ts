import type { ThreadDetail } from "@napier/contracts";

const SHA256 = /^[a-f0-9]{64}$/u;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;
const STATUSES = new Set([
  "skipped",
  "claimed",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "abandoned",
]);
const BLOCK_REASONS = new Set([
  "configuration_missing",
  "legacy_configuration",
  "policy_manual",
  "run_not_interrupted",
  "workflow_managed",
  "demo_model",
  "event_limit_exceeded",
  "unresolved_tool_call",
  "unsafe_tool_effect",
  "unknown_tool_effect",
  "attempt_limit_reached",
  "untrusted_recovery_chain",
]);

export function isConversationRecoveries(
  value: unknown,
): value is NonNullable<ThreadDetail["recoveries"]> {
  return (
    Array.isArray(value) &&
    value.length <= 8 &&
    value.every((recovery) => valid(recovery))
  );
}

function valid(value: unknown): boolean {
  if (
    !record(value) ||
    !resourceId(value["id"]) ||
    !integer(value["seq"], 1) ||
    !text(value["createdAt"]) ||
    typeof value["status"] !== "string" ||
    !STATUSES.has(value["status"]) ||
    !assessment(value["assessment"]) ||
    !eventIds(value["eventIds"]) ||
    (value["settlement"] !== undefined && !settlement(value["settlement"]))
  ) {
    return false;
  }
  if (value["status"] === "skipped") {
    return value["attempt"] === undefined;
  }
  return attempt(value["attempt"], value["status"]);
}

function assessment(value: unknown): boolean {
  if (!record(value) || !record(value["policy"])) return false;
  const blockReasons = value["blockReasons"];
  const eligible = value["eligible"];
  return (
    digest(value["contentSha256"]) &&
    resourceId(value["interruptedRunId"]) &&
    resourceId(value["rootRunId"]) &&
    typeof eligible === "boolean" &&
    Array.isArray(blockReasons) &&
    blockReasons.every(
      (reason) => typeof reason === "string" && BLOCK_REASONS.has(reason),
    ) &&
    new Set(blockReasons).size === blockReasons.length &&
    eligible === (blockReasons.length === 0) &&
    (value["policy"]["mode"] === "manual" ||
      value["policy"]["mode"] === "safe_read_only") &&
    integer(value["policy"]["maxAttempts"], 1, 3) &&
    integer(value["policy"]["backoffMs"], 1_000, 3_600_000) &&
    toolCalls(value["toolCalls"]) &&
    eventRange(value["eventRange"]) &&
    integer(value["priorAttempts"], 0, 3) &&
    text(value["assessedAt"])
  );
}

function toolCalls(value: unknown): boolean {
  if (!record(value)) return false;
  const total = number(value["total"]);
  const readOnly = number(value["readOnly"]);
  const unsafe = number(value["unsafe"]);
  const unknownEffect = number(value["unknownEffect"]);
  const unresolved = number(value["unresolved"]);
  return (
    total !== undefined &&
    readOnly !== undefined &&
    unsafe !== undefined &&
    unknownEffect !== undefined &&
    unresolved !== undefined &&
    total === readOnly + unsafe + unknownEffect &&
    unresolved <= total
  );
}

function eventRange(value: unknown): boolean {
  if (!record(value)) return false;
  const fromSeq = number(value["fromSeq"]);
  const toSeq = number(value["toSeq"]);
  const eventCount = number(value["eventCount"]);
  return (
    fromSeq !== undefined &&
    toSeq !== undefined &&
    eventCount !== undefined &&
    digest(value["eventStreamSha256"]) &&
    ((eventCount === 0 && fromSeq === 0 && toSeq === 0) ||
      (eventCount > 0 && fromSeq >= 1 && toSeq >= fromSeq))
  );
}

function attempt(value: unknown, status: unknown): boolean {
  if (!record(value)) return false;
  return (
    resourceId(value["id"]) &&
    value["status"] === status &&
    integer(value["attempt"], 1, 3) &&
    integer(value["maxAttempts"], Number(value["attempt"]), 3) &&
    integer(value["revision"], 1) &&
    (status === "claimed" || status === "abandoned"
      ? value["recoveryRunId"] === undefined
      : resourceId(value["recoveryRunId"]))
  );
}

function settlement(value: unknown): boolean {
  return (
    record(value) &&
    (value["budgetReason"] === "turns" ||
      value["budgetReason"] === "tokens" ||
      value["budgetReason"] === "cost" ||
      value["budgetReason"] === "timeout") &&
    optionalNumber(value["limit"]) &&
    optionalNumber(value["observedTurns"]) &&
    optionalNumber(value["observedTotalTokens"]) &&
    optionalNumber(value["observedCostUsd"]) &&
    optionalNumber(value["observedElapsedMs"])
  );
}

function eventIds(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 256 &&
    value.every((id) => text(id)) &&
    new Set(value).size === value.length
  );
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && RESOURCE_ID.test(value);
}

function digest(value: unknown): boolean {
  return typeof value === "string" && SHA256.test(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || number(value) !== undefined;
}

function integer(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): boolean {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
