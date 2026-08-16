import type { RunEvent, ThreadDetail } from "@napier/contracts";

export type ConversationMessage = NonNullable<ThreadDetail["messages"]>[number];

export function applyConversationMessage(
  messages: ConversationMessage[],
  event: RunEvent,
): ConversationMessage[] {
  if (event.type !== "message.user" && event.type !== "message.assistant") {
    return messages;
  }
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return messages;
  }
  const role = event.payload["role"];
  const text = event.payload["text"];
  if (
    (role !== "user" && role !== "assistant" && role !== "system") ||
    typeof text !== "string"
  ) {
    return messages;
  }
  return [
    ...messages,
    {
      id: event.id,
      seq: event.seq,
      role,
      text,
      model:
        typeof event.payload["model"] === "string"
          ? event.payload["model"]
          : "",
      createdAt: event.createdAt,
    },
  ];
}

export function projectConversationMessages(
  events: readonly RunEvent[],
): ConversationMessage[] {
  return events.reduce(applyConversationMessage, []);
}
