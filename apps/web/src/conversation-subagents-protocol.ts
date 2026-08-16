import type { ThreadDetail } from "@napier/contracts";

const TASK_ID = /^task_[a-z0-9]{8,80}$/u;
const STATUSES = new Set([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);
const ROLES = new Set(["general", "researcher", "coder", "reviewer"]);
const STOP_REASONS = new Set([
  "completed",
  "turn_capped",
  "timeout",
  "cancelled",
  "error",
]);
const OUTCOME_KINDS = new Set(["finding", "risk", "recommendation"]);
const OUTCOME_SEVERITIES = new Set(["info", "warning", "blocker"]);

export function isConversationSubagents(
  value: unknown,
): value is NonNullable<ThreadDetail["subagentCards"]> {
  return (
    Array.isArray(value) &&
    value.length <= 8 &&
    value.every((subagent) => valid(subagent))
  );
}

function valid(value: unknown): boolean {
  return (
    record(value) &&
    exact(value, [
      "id",
      "seq",
      "createdAt",
      "task",
      "itemCount",
      "evidenceCount",
      "unknownCount",
      "blockerCount",
      "warningCount",
    ]) &&
    text(value["id"]) &&
    integer(value["seq"], 1) &&
    text(value["createdAt"]) &&
    task(value["task"]) &&
    integer(value["itemCount"], 0, 64) &&
    integer(value["evidenceCount"], 0, 256) &&
    integer(value["unknownCount"], 0, 64) &&
    integer(value["blockerCount"], 0, Number(value["itemCount"])) &&
    integer(value["warningCount"], 0, Number(value["itemCount"])) &&
    Number(value["blockerCount"]) + Number(value["warningCount"]) <=
      Number(value["itemCount"])
  );
}

function task(value: unknown): boolean {
  if (!record(value) || !record(value["model"]) || !record(value["usage"])) {
    return false;
  }
  const status = value["status"];
  const stopReason = value["stopReason"];
  return (
    taskIdentity(value) &&
    modelAndUsage(value) &&
    taskOptionalFields(value) &&
    typeof status === "string" &&
    terminalFields(status, stopReason, value["outcome"], value["hasError"])
  );
}

function taskIdentity(value: Record<string, unknown>): boolean {
  return (
    exact(
      value,
      [
        "id",
        "role",
        "description",
        "status",
        "model",
        "stepCount",
        "turnCount",
        "usage",
      ],
      ["stopReason", "hasError", "outcome"],
    ) &&
    typeof value["id"] === "string" &&
    TASK_ID.test(value["id"]) &&
    typeof value["role"] === "string" &&
    ROLES.has(value["role"]) &&
    text(value["description"]) &&
    typeof value["status"] === "string" &&
    STATUSES.has(value["status"]) &&
    integer(value["stepCount"], 0) &&
    integer(value["turnCount"], 0)
  );
}

function modelAndUsage(value: Record<string, unknown>): boolean {
  const model = value["model"];
  const usage = value["usage"];
  return (
    record(model) &&
    record(usage) &&
    exact(model, ["provider", "id"]) &&
    exact(usage, ["inputTokens", "outputTokens"]) &&
    text(model["provider"]) &&
    text(model["id"]) &&
    integer(usage["inputTokens"], 0) &&
    integer(usage["outputTokens"], 0)
  );
}

function taskOptionalFields(value: Record<string, unknown>): boolean {
  const stopReason = value["stopReason"];
  return (
    (stopReason === undefined ||
      (typeof stopReason === "string" && STOP_REASONS.has(stopReason))) &&
    (value["hasError"] === undefined || value["hasError"] === true) &&
    (value["outcome"] === undefined || outcome(value["outcome"]))
  );
}

function terminalFields(
  status: string,
  stopReason: unknown,
  outcomeValue: unknown,
  hasError: unknown,
): boolean {
  if (status === "pending" || status === "running") {
    return (
      stopReason === undefined &&
      outcomeValue === undefined &&
      hasError === undefined
    );
  }
  if (status === "completed") {
    return stopReason === "completed" && outcomeValue !== undefined;
  }
  return (
    typeof stopReason === "string" &&
    outcomeValue === undefined &&
    (hasError === undefined || hasError === true)
  );
}

function outcome(value: unknown): boolean {
  return (
    record(value) &&
    exact(value, ["summary", "items"]) &&
    text(value["summary"]) &&
    Array.isArray(value["items"]) &&
    value["items"].length <= 5 &&
    value["items"].every((item) => outcomeItem(item))
  );
}

function outcomeItem(value: unknown): boolean {
  return (
    record(value) &&
    exact(value, ["kind", "severity", "title", "evidenceCount"]) &&
    typeof value["kind"] === "string" &&
    OUTCOME_KINDS.has(value["kind"]) &&
    typeof value["severity"] === "string" &&
    OUTCOME_SEVERITIES.has(value["severity"]) &&
    text(value["title"]) &&
    integer(value["evidenceCount"], 0, 256)
  );
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
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

function exact(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}
