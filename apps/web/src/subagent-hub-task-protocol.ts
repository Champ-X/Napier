import {
  boundedText,
  exactKeys,
  hash,
  jsonValue,
  nonNegativeInteger,
  optionalHash,
  optionalNonNegativeInteger,
  optionalResourceId,
  optionalText,
  optionalTimestamp,
  positiveInteger,
  record,
  resourceId,
  timestamp,
} from "./subagent-hub-protocol-primitives";

const ROLES = new Set(["researcher", "reviewer", "general", "coder"]);
const SUPERVISOR_STATUSES = new Set([
  "queued",
  "starting",
  "running",
  "waiting_input",
  "reviewing",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "orphaned",
]);
const TASK_STATUSES = new Set([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);
const STOP_REASONS = new Set([
  "completed",
  "turn_capped",
  "timeout",
  "cancelled",
  "error",
]);
const TRANSCRIPT_KINDS = new Set([
  "lifecycle",
  "assistant",
  "tool",
  "message",
  "outcome",
  "worktree",
]);
const UNAVAILABLE_REASONS = new Set([
  "execution_unavailable",
  "task_not_active",
  "task_not_terminal",
  "parent_run_not_running",
  "delegation_budget_exhausted",
  "role_disabled",
  "coder_write_scope_unavailable",
]);
const TASK_KEYS = [
  "taskId",
  "runId",
  "role",
  "description",
  "status",
  "taskStatus",
  "model",
  "routePlanId",
  "stepCount",
  "turnCount",
  "usage",
  "revision",
  "createdAt",
  "startedAt",
  "finishedAt",
  "stopReason",
  "mailbox",
  "lineage",
  "transcript",
  "typedOutput",
  "outcome",
  "worktree",
  "control",
];

export function isSubagentHubTask(value: unknown): boolean {
  if (!record(value) || !exactKeys(value, TASK_KEYS)) return false;
  return isTaskIdentity(value) && isTaskProgress(value) && isTaskDetail(value);
}

function isTaskIdentity(value: Record<string, unknown>): boolean {
  return (
    resourceId(value["taskId"]) &&
    resourceId(value["runId"]) &&
    typeof value["role"] === "string" &&
    ROLES.has(value["role"]) &&
    boundedText(value["description"], 180) &&
    typeof value["status"] === "string" &&
    SUPERVISOR_STATUSES.has(value["status"]) &&
    typeof value["taskStatus"] === "string" &&
    TASK_STATUSES.has(value["taskStatus"]) &&
    model(value["model"])
  );
}

function isTaskProgress(value: Record<string, unknown>): boolean {
  const stopReason = value["stopReason"];
  return (
    optionalResourceId(value["routePlanId"]) &&
    nonNegativeInteger(value["stepCount"]) &&
    nonNegativeInteger(value["turnCount"]) &&
    usage(value["usage"]) &&
    positiveInteger(value["revision"]) &&
    timestamp(value["createdAt"]) &&
    optionalTimestamp(value["startedAt"]) &&
    optionalTimestamp(value["finishedAt"]) &&
    (stopReason === undefined ||
      (typeof stopReason === "string" && STOP_REASONS.has(stopReason)))
  );
}

function isTaskDetail(value: Record<string, unknown>): boolean {
  const transcript = value["transcript"];
  return (
    mailbox(value["mailbox"]) &&
    lineage(value["lineage"]) &&
    Array.isArray(transcript) &&
    transcript.length <= 80 &&
    transcript.every(transcriptEntry) &&
    (value["typedOutput"] === undefined || typedOutput(value["typedOutput"])) &&
    (value["outcome"] === undefined || outcome(value["outcome"])) &&
    worktree(value["worktree"]) &&
    control(value["control"])
  );
}

function transcriptEntry(value: unknown): boolean {
  if (
    !record(value) ||
    !exactKeys(value, [
      "id",
      "seq",
      "createdAt",
      "eventType",
      "kind",
      "status",
      "messageKind",
      "text",
      "textSha256",
      "textBytes",
      "contentRedacted",
      "toolName",
      "isError",
    ])
  )
    return false;
  return transcriptIdentity(value) && transcriptContent(value);
}

function transcriptIdentity(value: Record<string, unknown>): boolean {
  return (
    resourceId(value["id"]) &&
    positiveInteger(value["seq"]) &&
    timestamp(value["createdAt"]) &&
    boundedText(value["eventType"], 160) &&
    typeof value["kind"] === "string" &&
    TRANSCRIPT_KINDS.has(value["kind"])
  );
}

function transcriptContent(value: Record<string, unknown>): boolean {
  const messageKind = value["messageKind"];
  return (
    optionalText(value["status"], 160) &&
    (messageKind === undefined ||
      messageKind === "steering" ||
      messageKind === "input") &&
    optionalText(value["text"], 8_000) &&
    optionalHash(value["textSha256"]) &&
    optionalNonNegativeInteger(value["textBytes"]) &&
    (value["contentRedacted"] === undefined ||
      value["contentRedacted"] === true) &&
    optionalText(value["toolName"], 160) &&
    (value["isError"] === undefined || typeof value["isError"] === "boolean")
  );
}

function mailbox(value: unknown): boolean {
  if (
    !record(value) ||
    !exactKeys(value, [
      "acceptedCount",
      "deliveredCount",
      "pendingCount",
      "lastAcceptedAt",
      "lastDeliveredAt",
    ])
  )
    return false;
  return (
    nonNegativeInteger(value["acceptedCount"]) &&
    nonNegativeInteger(value["deliveredCount"]) &&
    nonNegativeInteger(value["pendingCount"]) &&
    value["pendingCount"] ===
      Math.max(0, value["acceptedCount"] - value["deliveredCount"]) &&
    optionalTimestamp(value["lastAcceptedAt"]) &&
    optionalTimestamp(value["lastDeliveredAt"])
  );
}

function lineage(value: unknown): boolean {
  if (!record(value) || !exactKeys(value, ["parentTaskId", "childTaskIds"]))
    return false;
  const children = value["childTaskIds"];
  return (
    optionalResourceId(value["parentTaskId"]) &&
    Array.isArray(children) &&
    children.every(resourceId) &&
    new Set(children).size === children.length
  );
}

function typedOutput(value: unknown): boolean {
  return (
    record(value) &&
    exactKeys(value, ["schemaSha256", "value"]) &&
    hash(value["schemaSha256"]) &&
    jsonValue(value["value"])
  );
}

function outcome(value: unknown): boolean {
  if (
    !record(value) ||
    !exactKeys(value, [
      "contentSha256",
      "summary",
      "itemCount",
      "evidenceCount",
      "unknownCount",
      "blockerCount",
      "warningCount",
      "items",
    ])
  )
    return false;
  const items = value["items"];
  return (
    outcomeCounts(value) &&
    Array.isArray(items) &&
    items.length <= 8 &&
    items.every(outcomeItem)
  );
}

function outcomeCounts(value: Record<string, unknown>): boolean {
  return (
    hash(value["contentSha256"]) &&
    boundedText(value["summary"], 12_000) &&
    nonNegativeInteger(value["itemCount"]) &&
    nonNegativeInteger(value["evidenceCount"]) &&
    nonNegativeInteger(value["unknownCount"]) &&
    nonNegativeInteger(value["blockerCount"]) &&
    nonNegativeInteger(value["warningCount"])
  );
}

function outcomeItem(value: unknown): boolean {
  if (
    !record(value) ||
    !exactKeys(value, ["kind", "severity", "title", "evidenceCount"])
  )
    return false;
  const kind = value["kind"],
    severity = value["severity"];
  return (
    (kind === "finding" || kind === "risk" || kind === "recommendation") &&
    (severity === "info" || severity === "warning" || severity === "blocker") &&
    boundedText(value["title"], 1_000) &&
    nonNegativeInteger(value["evidenceCount"])
  );
}

function worktree(value: unknown): boolean {
  if (
    !record(value) ||
    !exactKeys(value, [
      "state",
      "writeScopeCount",
      "changedFileCount",
      "addedFileCount",
      "modifiedFileCount",
      "deletedFileCount",
      "renamedFileCount",
      "applyStatus",
      "postcondition",
      "diagnosticsStatus",
      "durable",
      "rollbackAttempted",
      "rollbackVerified",
      "changedFileSetSha256",
      "resultSha256",
    ])
  )
    return false;
  return (
    worktreeState(value) && worktreeCounts(value) && worktreeEvidence(value)
  );
}

function worktreeState(value: Record<string, unknown>): boolean {
  const state = value["state"],
    apply = value["applyStatus"],
    post = value["postcondition"];
  return (
    [
      "none",
      "isolated",
      "preview_ready",
      "applied",
      "rolled_back",
      "indeterminate",
    ].includes(String(state)) &&
    (apply === undefined ||
      ["applied", "rolled_back", "indeterminate"].includes(String(apply))) &&
    (post === undefined ||
      ["verified", "drifted", "indeterminate"].includes(String(post)))
  );
}

function worktreeCounts(value: Record<string, unknown>): boolean {
  return [
    "writeScopeCount",
    "changedFileCount",
    "addedFileCount",
    "modifiedFileCount",
    "deletedFileCount",
    "renamedFileCount",
  ].every((key) => optionalNonNegativeInteger(value[key]));
}

function worktreeEvidence(value: Record<string, unknown>): boolean {
  return (
    optionalText(value["diagnosticsStatus"], 160) &&
    ["durable", "rollbackAttempted", "rollbackVerified"].every(
      (key) => value[key] === undefined || typeof value[key] === "boolean",
    ) &&
    optionalHash(value["changedFileSetSha256"]) &&
    optionalHash(value["resultSha256"])
  );
}

function control(value: unknown): boolean {
  if (
    !record(value) ||
    !exactKeys(value, ["steer", "cancel", "revive", "unavailableReason"])
  )
    return false;
  if (
    typeof value["steer"] !== "boolean" ||
    typeof value["cancel"] !== "boolean" ||
    typeof value["revive"] !== "boolean"
  )
    return false;
  const enabled = value["steer"] || value["cancel"] || value["revive"];
  return enabled
    ? value["unavailableReason"] === undefined
    : typeof value["unavailableReason"] === "string" &&
        UNAVAILABLE_REASONS.has(value["unavailableReason"]);
}

function model(value: unknown): boolean {
  return (
    record(value) &&
    exactKeys(value, ["provider", "id"]) &&
    boundedText(value["provider"], 80) &&
    boundedText(value["id"], 160)
  );
}

function usage(value: unknown): boolean {
  if (
    !record(value) ||
    !exactKeys(value, [
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
      "costUsd",
    ])
  )
    return false;
  return (
    [
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
    ].every((key) => nonNegativeInteger(value[key])) &&
    typeof value["costUsd"] === "number" &&
    Number.isFinite(value["costUsd"]) &&
    value["costUsd"] >= 0
  );
}
