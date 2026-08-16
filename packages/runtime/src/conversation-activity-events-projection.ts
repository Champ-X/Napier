import type { RunEvent } from "@napier/contracts";

const TOOL_EVENT = /^tool\.(started|completed|failed|blocked)$/u;
const MAX_CALLS = 32;

export function applyConversationActivityEvent(
  events: RunEvent[],
  event: RunEvent,
): RunEvent[] {
  if (event.visibility !== "user" || !TOOL_EVENT.test(event.type)) {
    return events;
  }
  const callId = payloadString(event, "callId");
  if (!callId) return events;
  const next = [...events, structuredClone(event)];
  const callIds = uniqueCallIds(next);
  if (callIds.length <= MAX_CALLS) return next;
  const retained = new Set(callIds.slice(-MAX_CALLS));
  return next.filter((candidate) => {
    const candidateCallId = payloadString(candidate, "callId");
    return candidateCallId !== undefined && retained.has(candidateCallId);
  });
}

export function projectConversationActivityEvents(
  events: readonly RunEvent[],
): RunEvent[] {
  return events.reduce(applyConversationActivityEvent, []);
}

function uniqueCallIds(events: readonly RunEvent[]): string[] {
  const callIds: string[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const callId = payloadString(event, "callId");
    if (!callId || seen.has(callId)) continue;
    seen.add(callId);
    callIds.push(callId);
  }
  return callIds;
}

function payloadString(event: RunEvent, key: string): string | undefined {
  return event.payload &&
    typeof event.payload === "object" &&
    !Array.isArray(event.payload) &&
    typeof event.payload[key] === "string"
    ? event.payload[key]
    : undefined;
}
