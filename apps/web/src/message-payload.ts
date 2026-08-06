import type { RunEvent, TextMessagePayload } from "@napier/contracts";

export function messagePayload(
  event: RunEvent,
): TextMessagePayload | undefined {
  if (
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    return undefined;
  }
  const role = event.payload["role"];
  const text = event.payload["text"];
  if (
    (role !== "user" && role !== "assistant" && role !== "system") ||
    typeof text !== "string"
  ) {
    return undefined;
  }
  return {
    role,
    text,
    ...(typeof event.payload["reasoning"] === "string"
      ? { reasoning: event.payload["reasoning"] }
      : {}),
    ...(typeof event.payload["model"] === "string"
      ? { model: event.payload["model"] }
      : {}),
  };
}
