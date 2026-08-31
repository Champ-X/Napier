import type { RunEvent, RunRecord } from "@napier/contracts";

import {
  traceEventSummaryView,
  type TraceEventSummarySource,
} from "./trace-event-summary-view";
import {
  attachTraceTrajectoryEventDurations,
  traceTrajectoryCallKey,
  traceTrajectoryTerminalEvent,
} from "./trace-trajectory-events";
import {
  createTraceTrajectoryEventIndex,
  createTraceTrajectorySourceIndex,
  type TraceTrajectoryCallPairs,
  type TraceTrajectoryEventIndex,
} from "./trace-trajectory-index";

export { traceTrajectoryIsKeyEvent } from "./trace-trajectory-events";

export type TraceTrajectoryMetric = "duration" | "turns" | "calls";
export type TraceTrajectoryLane = "input" | "model" | "tools";
export type TraceTrajectoryStatus =
  | "active"
  | "completed"
  | "failed"
  | "neutral";

export interface TraceTrajectoryEvent {
  event: RunEvent;
  summary: string;
  summarySource: TraceEventSummarySource;
  lane: TraceTrajectoryLane;
  role: string;
  label: string;
  turnIndex: number;
  callOrdinal?: number;
  timestampMs: number;
  status: TraceTrajectoryStatus;
  durationMs?: number;
}

export interface TraceTrajectorySegment {
  id: string;
  eventId: string;
  runId: string;
  lane: TraceTrajectoryLane;
  status: TraceTrajectoryStatus;
  label: string;
  startMs: number;
  endMs: number;
  turnIndex: number;
  callOrdinal?: number;
  seq: number;
}

export interface TraceTrajectoryTurn {
  index: number;
  label: string;
  events: TraceTrajectoryEvent[];
}

export interface TraceTrajectoryRun {
  id: string;
  ordinal: number;
  status: RunRecord["status"] | "unknown";
  startedAt?: string;
  finishedAt?: string;
  durationMs: number;
  events: TraceTrajectoryEvent[];
  turns: TraceTrajectoryTurn[];
}

export interface TraceTrajectoryModel {
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  turnCount: number;
  callCount: number;
  eventCount: number;
  events: TraceTrajectoryEvent[];
  index: TraceTrajectoryEventIndex<TraceTrajectoryEvent>;
  segments: TraceTrajectorySegment[];
  runs: TraceTrajectoryRun[];
}

export interface TraceTrajectoryPosition {
  left: number;
  width: number;
}

export interface TraceTrajectoryRange {
  start: number;
  end: number;
}

export function createTraceTrajectoryModel(
  eventsInput: readonly RunEvent[],
  runsInput: readonly RunRecord[],
): TraceTrajectoryModel {
  const events = eventsInput.slice().sort(compareEvents);
  const runsById = new Map(runsInput.map((run) => [run.id, run]));
  const sourceIndex = createTraceTrajectorySourceIndex(events, runsInput);
  const projectedEvents = attachTraceTrajectoryEventDurations(
    events,
    events.map((event) =>
      projectEvent(
        event,
        sourceIndex.turnIndexByEvent.get(event.id) ?? 0,
        sourceIndex.callOrdinalByKey.get(traceTrajectoryCallKey(event) ?? ""),
      ),
    ),
  );
  const startedAtMs = sourceIndex.startedAtMs;
  const endedAtMs = sourceIndex.endedAtMs;
  const durationMs = Math.max(1, endedAtMs - startedAtMs);
  const projectedIndex = createTraceTrajectoryEventIndex(projectedEvents);
  return {
    startedAtMs,
    endedAtMs,
    durationMs,
    turnCount: sourceIndex.turnCount,
    callCount: sourceIndex.callOrdinalByKey.size,
    eventCount: projectedEvents.length,
    events: projectedEvents,
    index: projectedIndex,
    segments: createSegments(
      events,
      projectedIndex.byId,
      sourceIndex.turnIndexByEvent,
      sourceIndex.callOrdinalByKey,
      sourceIndex.callPairs,
    ),
    runs: sourceIndex.runIds.map((runId, index) =>
      projectRun(
        runId,
        index + 1,
        projectedIndex.byRun.get(runId) ?? [],
        runsById.get(runId),
      ),
    ),
  };
}

export function traceTrajectoryPosition(
  segment: TraceTrajectorySegment,
  model: TraceTrajectoryModel,
  metric: TraceTrajectoryMetric,
): TraceTrajectoryPosition {
  if (metric === "duration") {
    const left =
      ((segment.startMs - model.startedAtMs) / model.durationMs) * 100;
    const width = ((segment.endMs - segment.startMs) / model.durationMs) * 100;
    return boundedPosition(left, width);
  }
  if (metric === "turns") {
    const slots = Math.max(1, model.turnCount + 1);
    return boundedPosition((segment.turnIndex / slots) * 100, 72 / slots);
  }
  if (segment.callOrdinal !== undefined) {
    const slots = Math.max(1, model.callCount);
    return boundedPosition(
      ((segment.callOrdinal - 1) / slots) * 100,
      72 / slots,
    );
  }
  const denominator = Math.max(1, model.eventCount);
  return boundedPosition(((segment.seq - 1) / denominator) * 100, 0);
}

export function traceTrajectoryEventRatio(
  event: TraceTrajectoryEvent,
  model: TraceTrajectoryModel,
  metric: TraceTrajectoryMetric,
): number {
  if (metric === "duration") {
    return clampRatio(
      (event.timestampMs - model.startedAtMs) / model.durationMs,
    );
  }
  if (metric === "turns") {
    return clampRatio(event.turnIndex / Math.max(1, model.turnCount + 1));
  }
  return clampRatio(
    event.callOrdinal !== undefined
      ? (event.callOrdinal - 1) / Math.max(1, model.callCount)
      : (event.event.seq - 1) / Math.max(1, model.eventCount),
  );
}

export function traceTrajectoryEventInRange(
  event: TraceTrajectoryEvent,
  model: TraceTrajectoryModel,
  metric: TraceTrajectoryMetric,
  range: TraceTrajectoryRange | undefined,
): boolean {
  if (!range) return true;
  const ratio = traceTrajectoryEventRatio(event, model, metric);
  return ratio >= range.start && ratio <= range.end;
}

export function traceTrajectoryMatches(
  event: TraceTrajectoryEvent,
  query: string,
): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [
    event.event.type,
    event.event.category,
    event.label,
    event.summary,
    event.role,
    event.event.runId,
    String(event.event.seq),
  ].some((value) => value.toLocaleLowerCase().includes(normalized));
}

function projectEvent(
  event: RunEvent,
  turnIndex: number,
  callOrdinal: number | undefined,
): TraceTrajectoryEvent {
  const summary = traceEventSummaryView(event);
  return {
    event,
    summary: summary.text,
    summarySource: summary.source,
    lane: eventLane(event),
    role: eventRole(event),
    label: eventLabel(event),
    turnIndex,
    ...(callOrdinal !== undefined ? { callOrdinal } : {}),
    timestampMs: timestamp(event.createdAt),
    status: segmentStatus(event),
  };
}

function createSegments(
  events: RunEvent[],
  projectedById: Map<string, TraceTrajectoryEvent>,
  turnIndexByEvent: Map<string, number>,
  callOrdinalByKey: Map<string, number>,
  callPairs: TraceTrajectoryCallPairs,
): TraceTrajectorySegment[] {
  const segments: TraceTrajectorySegment[] = [];
  for (const event of events) {
    if (!overviewEvent(event)) continue;
    const projected = projectedById.get(event.id);
    if (!projected) continue;
    const key = traceTrajectoryCallKey(event);
    if (
      key &&
      traceTrajectoryTerminalEvent(event) &&
      callPairs.pairedTerminalIds.has(event.id)
    ) {
      continue;
    }
    const terminal = key ? callPairs.terminalByCall.get(key) : undefined;
    const startMs = timestamp(event.createdAt);
    const endMs =
      terminal && timestamp(terminal.createdAt) >= startMs
        ? timestamp(terminal.createdAt)
        : startMs;
    segments.push({
      id: `trajectory_${event.id}`,
      eventId: terminal?.id ?? event.id,
      runId: event.runId,
      lane: projected.lane,
      status: segmentStatus(terminal ?? event),
      label: projected.label,
      startMs,
      endMs,
      turnIndex: turnIndexByEvent.get(event.id) ?? 0,
      ...(key && callOrdinalByKey.has(key)
        ? { callOrdinal: callOrdinalByKey.get(key)! }
        : {}),
      seq: event.seq,
    });
  }
  return segments;
}

function projectRun(
  runId: string,
  ordinal: number,
  events: TraceTrajectoryEvent[],
  run: RunRecord | undefined,
): TraceTrajectoryRun {
  const eventsByTurn = new Map<number, TraceTrajectoryEvent[]>();
  for (const event of events) {
    const turnEvents = eventsByTurn.get(event.turnIndex);
    if (turnEvents) turnEvents.push(event);
    else eventsByTurn.set(event.turnIndex, [event]);
  }
  const turns = [...eventsByTurn].map(([index, turnEvents]) => ({
    index,
    label: index === 0 ? "Setup" : `Turn ${String(index)}`,
    events: turnEvents,
  }));
  const firstEvent = events[0];
  const lastEvent = events.at(-1);
  const startedAt = run?.startedAt ?? firstEvent?.event.createdAt;
  const finishedAt = run?.finishedAt ?? lastEvent?.event.createdAt;
  return {
    id: runId,
    ordinal,
    status: run?.status ?? "unknown",
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    durationMs:
      startedAt && finishedAt
        ? Math.max(0, timestamp(finishedAt) - timestamp(startedAt))
        : 0,
    events,
    turns,
  };
}

function overviewEvent(event: RunEvent): boolean {
  if (
    event.type === "model.text.delta" ||
    event.type === "model.thinking.delta"
  ) {
    return false;
  }
  return (
    event.type === "run.started" ||
    event.type === "turn.started" ||
    event.type === "message.user" ||
    event.type === "message.assistant" ||
    event.type === "context.model_envelope" ||
    event.type === "route_plan_created" ||
    event.type === "route_attempt_started" ||
    event.type === "model.response" ||
    event.type === "tool.started" ||
    traceTrajectoryTerminalEvent(event)
  );
}

function eventLane(event: RunEvent): TraceTrajectoryLane {
  if (
    event.category === "tool" ||
    event.category === "artifact" ||
    event.category === "subagent" ||
    event.type.startsWith("workspace.") ||
    event.type.startsWith("browser.")
  ) {
    return "tools";
  }
  if (
    event.category === "model" ||
    event.type === "message.assistant" ||
    event.type.startsWith("model.") ||
    event.type.startsWith("route_")
  ) {
    return "model";
  }
  return "input";
}

function eventRole(event: RunEvent): string {
  if (event.type === "message.user") return "USER";
  if (event.type === "message.assistant") return "ASSISTANT";
  if (event.type.startsWith("context.")) return "CONTEXT";
  if (event.type.startsWith("tool.")) return "TOOL";
  if (event.type.startsWith("model.")) return "MODEL";
  if (event.type.startsWith("route_")) return "ROUTE";
  if (event.type.startsWith("run.") || event.type.startsWith("turn.")) {
    return "RUN";
  }
  return event.type.split(/[._]/u)[0]!.toLocaleUpperCase();
}

function eventLabel(event: RunEvent): string {
  const payload = record(event.payload);
  if (
    event.type.startsWith("tool.") &&
    typeof payload?.["toolName"] === "string"
  ) {
    return `${payload["toolName"]} · ${event.type.split(".").at(-1)}`;
  }
  if (event.type === "message.user") return "User message";
  if (event.type === "message.assistant") return "Assistant result";
  if (event.type.startsWith("route_attempt_")) {
    const model =
      typeof payload?.["providerId"] === "string" &&
      typeof payload["modelId"] === "string"
        ? `${payload["providerId"]}/${payload["modelId"]}`
        : "model";
    return `${model} · ${event.type === "route_attempt_started" ? "attempt" : "result"}`;
  }
  return event.type
    .split(/[._]/u)
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");
}

function segmentStatus(event: RunEvent): TraceTrajectoryStatus {
  const payload = record(event.payload);
  if (event.type === "route_attempt_ended") {
    return payload?.["outcome"] === "terminal" ? "failed" : "completed";
  }
  if (
    event.type.includes("failed") ||
    event.type.includes("blocked") ||
    event.type.includes("cancelled")
  ) {
    return "failed";
  }
  if (event.type === "run.started" || event.type === "turn.started") {
    return "neutral";
  }
  if (event.type.endsWith("started")) return "active";
  if (
    event.type.endsWith("completed") ||
    event.type.endsWith("created") ||
    event.type.endsWith("produced") ||
    event.type.endsWith("verified") ||
    event.type.endsWith("recorded") ||
    event.type.endsWith("updated") ||
    event.type.endsWith("applied") ||
    event.type === "model.response" ||
    event.type === "message.assistant"
  ) {
    return "completed";
  }
  return "neutral";
}

function boundedPosition(leftInput: number, widthInput: number) {
  const left = Math.min(100, Math.max(0, leftInput));
  const width = Math.min(100 - left, Math.max(0, widthInput));
  return { left, width };
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function compareEvents(left: RunEvent, right: RunEvent): number {
  const timestampDelta = timestamp(left.createdAt) - timestamp(right.createdAt);
  return timestampDelta || left.seq - right.seq;
}

function timestamp(value: string): number {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : 0;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
