import type { RunEvent, ThreadDetail } from "@napier/contracts";

export function isConversationActivityEvents(
  value: unknown,
): value is NonNullable<ThreadDetail["activityEvents"]> {
  return (
    Array.isArray(value) &&
    value.length <= 128 &&
    value.every((event) => activityEvent(event))
  );
}

function activityEvent(value: unknown): value is RunEvent {
  if (!record(value) || !record(value["payload"])) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["threadId"] === "string" &&
    typeof value["runId"] === "string" &&
    integer(value["seq"], 1) &&
    typeof value["type"] === "string" &&
    /^tool\.(started|completed|failed|blocked)$/u.test(value["type"]) &&
    value["category"] === "tool" &&
    value["visibility"] === "user" &&
    typeof value["createdAt"] === "string" &&
    typeof value["payload"]["callId"] === "string"
  );
}

function integer(value: unknown, minimum: number): boolean {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
