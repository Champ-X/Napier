import type { JsonValue, RunEvent } from "@napier/contracts";

export interface ToolTrace {
  callId: string;
  toolName: string;
  events: RunEvent[];
  started?: RunEvent;
  terminal?: RunEvent;
}

export function collectToolTraces(events: readonly RunEvent[]): ToolTrace[] {
  const traces = new Map<string, ToolTrace>();
  for (const event of events) {
    if (event.category !== "tool") continue;
    const callId = payloadString(event.payload, "callId");
    const toolName = payloadString(event.payload, "toolName");
    if (!callId || !toolName) continue;
    const key = `${event.runId}:${callId}`;
    const existing = traces.get(key) ?? {
      callId,
      toolName,
      events: [],
    };
    existing.events.push(event);
    if (event.type === "tool.started" && !existing.started) {
      existing.started = event;
    }
    if (
      (event.type === "tool.completed" ||
        event.type === "tool.failed" ||
        event.type === "tool.blocked") &&
      !existing.terminal
    ) {
      existing.terminal = event;
    }
    traces.set(key, existing);
  }
  return [...traces.values()].sort(
    (left, right) => (left.events[0]?.seq ?? 0) - (right.events[0]?.seq ?? 0),
  );
}

function payloadString(payload: JsonValue, key: string): string | undefined {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return undefined;
  }
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}
