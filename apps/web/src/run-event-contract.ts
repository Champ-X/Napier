import type {
  EventCategory,
  EventVisibility,
  RunEvent,
} from "@napier/contracts";

const EVENT_CATEGORIES = new Set<EventCategory>([
  "lifecycle",
  "message",
  "model",
  "tool",
  "memory",
  "subagent",
  "plan",
  "goal",
  "artifact",
  "credential",
  "evaluation",
  "automation",
  "channel",
  "system",
]);
const EVENT_VISIBILITIES = new Set<EventVisibility>([
  "user",
  "debug",
  "hidden",
]);

export function isRunEventRecord(event: unknown): event is RunEvent {
  return (
    record(event) &&
    typeof event["id"] === "string" &&
    typeof event["threadId"] === "string" &&
    typeof event["runId"] === "string" &&
    integer(event["seq"], 1) &&
    typeof event["type"] === "string" &&
    typeof event["category"] === "string" &&
    EVENT_CATEGORIES.has(event["category"] as EventCategory) &&
    typeof event["visibility"] === "string" &&
    EVENT_VISIBILITIES.has(event["visibility"] as EventVisibility) &&
    typeof event["createdAt"] === "string" &&
    Object.prototype.hasOwnProperty.call(event, "payload")
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
