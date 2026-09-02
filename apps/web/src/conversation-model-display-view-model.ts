import type { JsonValue, RunEvent } from "@napier/contracts";

export interface LocalConversationModelDisplay {
  sourceThreadId: string;
  sourceRunId: string;
  responseEventId: string;
  modelContextEnvelopeTurnIndex?: number;
  text?: string;
  thinking?: string;
  origin: "captured_response" | "conversation_surface";
}

export function projectLocalModelDisplays(
  events: RunEvent[],
  displays: readonly LocalConversationModelDisplay[],
): RunEvent[] {
  if (displays.length === 0) return events;
  const byEventId = new Map(
    displays.map((display) => [display.responseEventId, display]),
  );
  return events.map((event) => {
    if (
      event.type !== "model.response" ||
      !event.payload ||
      typeof event.payload !== "object" ||
      Array.isArray(event.payload)
    ) {
      return event;
    }
    const display = byEventId.get(event.id);
    if (
      !display ||
      display.sourceThreadId !== event.threadId ||
      display.sourceRunId !== event.runId
    ) {
      return event;
    }
    const payload = event.payload as Record<string, JsonValue>;
    return {
      ...event,
      payload: {
        ...payload,
        localDisplaySchemaVersion: 1,
        localDisplayOrigin: display.origin,
        ...(display.text ? { localDisplayText: display.text } : {}),
        ...(display.thinking ? { localDisplayThinking: display.thinking } : {}),
      },
    };
  });
}
