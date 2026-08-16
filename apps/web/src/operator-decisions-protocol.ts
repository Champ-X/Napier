import type { OperatorDecision } from "@napier/contracts";

const STATUSES = new Set(["pending", "answered", "continued", "cancelled"]);
const CANCELLATION_REASONS = new Set([
  "operator_cancelled",
  "workflow_timed_out",
  "run_completed_without_wait",
  "run_failed",
  "run_cancelled",
]);

export function isOperatorDecisions(
  value: unknown,
): value is OperatorDecision[] {
  return Array.isArray(value) && value.every((decision) => valid(decision));
}

function valid(value: unknown): boolean {
  if (!record(value) || !base(value)) return false;
  switch (value["status"]) {
    case "pending":
      return noAnswer(value) && noContinuation(value) && noCancellation(value);
    case "answered":
      return answer(value) && noContinuation(value) && noCancellation(value);
    case "continued":
      return answer(value) && continuation(value) && noCancellation(value);
    case "cancelled":
      return (
        cancellation(value) && noContinuation(value) && optionalAnswer(value)
      );
    default:
      return false;
  }
}

function base(value: Record<string, unknown>): boolean {
  return (
    value["kind"] === "napier.operator-decision" &&
    value["schemaVersion"] === 1 &&
    text(value["id"]) &&
    text(value["threadId"]) &&
    text(value["runId"]) &&
    typeof value["status"] === "string" &&
    STATUSES.has(value["status"]) &&
    text(value["header"]) &&
    text(value["question"]) &&
    options(value["options"]) &&
    typeof value["multiSelect"] === "boolean" &&
    digest(value["questionSha256"]) &&
    text(value["requestedAt"]) &&
    integer(value["requestedEventSeq"], 1) &&
    digest(value["contentSha256"])
  );
}

function options(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) {
    return false;
  }
  const ids = new Set<string>();
  for (const option of value) {
    if (
      !record(option) ||
      typeof option["id"] !== "string" ||
      !/^option_[1-4]$/u.test(option["id"]) ||
      !text(option["label"]) ||
      typeof option["description"] !== "string" ||
      ids.has(option["id"])
    ) {
      return false;
    }
    ids.add(option["id"]);
  }
  return true;
}

function answer(value: Record<string, unknown>): boolean {
  const selected = value["selectedOptionIds"];
  const optionIds = new Set(
    (value["options"] as Array<Record<string, unknown>>).map(
      (option) => option["id"],
    ),
  );
  return (
    text(value["answeredAt"]) &&
    integer(
      value["answeredEventSeq"],
      Number(value["requestedEventSeq"]) + 1,
    ) &&
    Array.isArray(selected) &&
    selected.every(
      (optionId) => typeof optionId === "string" && optionIds.has(optionId),
    ) &&
    new Set(selected).size === selected.length &&
    (value["multiSelect"] === true || selected.length <= 1) &&
    (value["customText"] === undefined ||
      typeof value["customText"] === "string") &&
    (selected.length > 0 ||
      (typeof value["customText"] === "string" &&
        value["customText"].trim().length > 0)) &&
    digest(value["answerSha256"])
  );
}

function optionalAnswer(value: Record<string, unknown>): boolean {
  return noAnswer(value) || answer(value);
}

function noAnswer(value: Record<string, unknown>): boolean {
  return absent(value, [
    "answeredAt",
    "answeredEventSeq",
    "selectedOptionIds",
    "customText",
    "answerSha256",
  ]);
}

function continuation(value: Record<string, unknown>): boolean {
  return (
    text(value["continuedAt"]) &&
    integer(
      value["continuedEventSeq"],
      Number(value["answeredEventSeq"]) + 1,
    ) &&
    text(value["continuationRunId"])
  );
}

function noContinuation(value: Record<string, unknown>): boolean {
  return absent(value, [
    "continuedAt",
    "continuedEventSeq",
    "continuationRunId",
  ]);
}

function cancellation(value: Record<string, unknown>): boolean {
  const priorSeq =
    typeof value["answeredEventSeq"] === "number"
      ? value["answeredEventSeq"]
      : value["requestedEventSeq"];
  return (
    text(value["cancelledAt"]) &&
    integer(value["cancellationEventSeq"], Number(priorSeq) + 1) &&
    typeof value["cancellationReason"] === "string" &&
    CANCELLATION_REASONS.has(value["cancellationReason"])
  );
}

function noCancellation(value: Record<string, unknown>): boolean {
  return absent(value, [
    "cancelledAt",
    "cancellationEventSeq",
    "cancellationReason",
  ]);
}

function absent(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => value[key] === undefined);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function digest(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function integer(value: unknown, minimum: number): boolean {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
