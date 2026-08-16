import type { ThreadDetail } from "@napier/contracts";

export function isConversationMessages(
  value: unknown,
): value is NonNullable<ThreadDetail["messages"]> {
  return (
    Array.isArray(value) &&
    value.every(
      (message) =>
        record(message) &&
        typeof message["id"] === "string" &&
        integer(message["seq"], 1) &&
        (message["role"] === "user" ||
          message["role"] === "assistant" ||
          message["role"] === "system") &&
        typeof message["text"] === "string" &&
        typeof message["model"] === "string" &&
        typeof message["createdAt"] === "string",
    )
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
