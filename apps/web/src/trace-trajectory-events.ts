import type { RunEvent } from "@napier/contracts";

interface TraceEventProjection {
  event: RunEvent;
  durationMs?: number;
}

export function traceTrajectoryIsKeyEvent(
  event: TraceEventProjection,
): boolean {
  const type = event.event.type;
  if (type === "message.user" || type === "message.assistant") return true;
  if (type === "model.response") return true;
  if (type.startsWith("route_")) return true;
  if (
    type === "tool.completed" ||
    type === "tool.failed" ||
    type === "tool.blocked" ||
    type === "tool.result_reused"
  ) {
    return true;
  }
  if (
    type === "run.completed" ||
    type === "run.failed" ||
    type === "run.cancelled" ||
    type === "run.partially_completed"
  ) {
    return true;
  }
  return (
    type.startsWith("plan.") ||
    type.startsWith("artifact.") ||
    type.startsWith("workspace.file.") ||
    type.startsWith("browser.") ||
    type.startsWith("subagent.") ||
    type.startsWith("operator.decision.") ||
    type.startsWith("goal.")
  );
}

export function attachTraceTrajectoryEventDurations<
  T extends TraceEventProjection,
>(source: RunEvent[], projected: T[]): T[] {
  const startedAtByCall = new Map<string, number>();
  const durationByEvent = new Map<string, number>();
  for (const event of source) {
    const key = traceTrajectoryCallKey(event);
    if (!key) continue;
    if (traceTrajectoryStartEvent(event)) {
      startedAtByCall.set(key, eventTimestamp(event));
      continue;
    }
    if (!traceTrajectoryTerminalEvent(event)) continue;
    const startedAt = startedAtByCall.get(key);
    if (startedAt !== undefined) {
      durationByEvent.set(
        event.id,
        Math.max(0, eventTimestamp(event) - startedAt),
      );
    }
  }
  return projected.map((event) => {
    const durationMs = durationByEvent.get(event.event.id);
    return durationMs === undefined ? event : { ...event, durationMs };
  });
}

export function traceTrajectoryCallKey(event: RunEvent): string | undefined {
  const payload = record(event.payload);
  if (
    (event.type === "route_attempt_started" ||
      event.type === "route_attempt_ended") &&
    typeof payload?.["attemptId"] === "string"
  ) {
    return `route:${event.runId}:${payload["attemptId"]}`;
  }
  if (typeof payload?.["callId"] === "string") {
    return `tool:${event.runId}:${payload["callId"]}`;
  }
  const turnIndex =
    integer(payload?.["turnIndex"]) ??
    integer(payload?.["modelContextEnvelopeTurnIndex"]);
  return turnIndex !== undefined &&
    (event.type.startsWith("context.model_") || event.type === "model.response")
    ? `model:${event.runId}:${String(turnIndex)}`
    : undefined;
}

export function traceTrajectoryStartEvent(event: RunEvent): boolean {
  return (
    event.type === "tool.started" ||
    event.type === "context.model_envelope" ||
    event.type === "route_attempt_started"
  );
}

export function traceTrajectoryTerminalEvent(event: RunEvent): boolean {
  return (
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "tool.blocked" ||
    event.type === "route_attempt_ended" ||
    event.type === "model.response"
  );
}

function eventTimestamp(event: RunEvent): number {
  const result = Date.parse(event.createdAt);
  return Number.isFinite(result) ? result : 0;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}
