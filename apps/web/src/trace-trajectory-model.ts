import type { RunEvent, RunRecord } from "@napier/contracts";

import {
  traceEventSummaryView,
  type TraceEventSummarySource,
} from "./trace-event-summary-view";

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
  segments: TraceTrajectorySegment[];
  runs: TraceTrajectoryRun[];
}

export interface TraceTrajectoryPosition {
  left: number;
  width: number;
}

export function createTraceTrajectoryModel(
  eventsInput: readonly RunEvent[],
  runsInput: readonly RunRecord[],
): TraceTrajectoryModel {
  const events = eventsInput.slice().sort(compareEvents);
  const runsById = new Map(runsInput.map((run) => [run.id, run]));
  const runIds = orderedRunIds(events, runsInput);
  const turnIndexByEvent = indexTurns(events);
  const callOrdinalByKey = indexCalls(events);
  const projectedEvents = events.map((event) =>
    projectEvent(
      event,
      turnIndexByEvent.get(event.id) ?? 0,
      callOrdinalByKey.get(callKey(event) ?? ""),
    ),
  );
  const startedAtMs = timelineStart(events, runsInput);
  const endedAtMs = timelineEnd(events, runsInput, startedAtMs);
  const durationMs = Math.max(1, endedAtMs - startedAtMs);
  const turnCount = Math.max(0, ...turnIndexByEvent.values());
  const callCount = callOrdinalByKey.size;
  const projectedById = new Map(
    projectedEvents.map((event) => [event.event.id, event]),
  );
  return {
    startedAtMs,
    endedAtMs,
    durationMs,
    turnCount,
    callCount,
    eventCount: projectedEvents.length,
    events: projectedEvents,
    segments: createSegments(
      events,
      projectedById,
      turnIndexByEvent,
      callOrdinalByKey,
    ),
    runs: runIds.map((runId, index) =>
      projectRun(
        runId,
        index + 1,
        projectedEvents.filter((event) => event.event.runId === runId),
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
  return boundedPosition(((segment.seq - 1) / denominator) * 100, 1.4);
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
  };
}

function createSegments(
  events: RunEvent[],
  projectedById: Map<string, TraceTrajectoryEvent>,
  turnIndexByEvent: Map<string, number>,
  callOrdinalByKey: Map<string, number>,
): TraceTrajectorySegment[] {
  const terminalByCall = new Map<string, RunEvent>();
  for (const event of events) {
    const key = callKey(event);
    if (key && terminalEvent(event)) terminalByCall.set(key, event);
  }
  const segments: TraceTrajectorySegment[] = [];
  for (const event of events) {
    if (!overviewEvent(event)) continue;
    const projected = projectedById.get(event.id);
    if (!projected) continue;
    const key = callKey(event);
    if (key && terminalEvent(event) && pairedStart(events, event, key)) {
      continue;
    }
    const terminal = key ? terminalByCall.get(key) : undefined;
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
  const turnIndexes = [...new Set(events.map((event) => event.turnIndex))];
  const turns = turnIndexes.map((index) => ({
    index,
    label: index === 0 ? "Setup" : `Turn ${String(index)}`,
    events: events.filter((event) => event.turnIndex === index),
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

function orderedRunIds(
  events: RunEvent[],
  runs: readonly RunRecord[],
): string[] {
  const ids = new Set<string>();
  for (const run of runs) ids.add(run.id);
  for (const event of events) ids.add(event.runId);
  return [...ids].sort((left, right) => {
    const leftRun = runs.find((run) => run.id === left);
    const rightRun = runs.find((run) => run.id === right);
    const leftTime =
      leftRun?.startedAt ??
      events.find((event) => event.runId === left)?.createdAt ??
      "";
    const rightTime =
      rightRun?.startedAt ??
      events.find((event) => event.runId === right)?.createdAt ??
      "";
    return leftTime.localeCompare(rightTime);
  });
}

function indexTurns(events: RunEvent[]): Map<string, number> {
  const currentByRun = new Map<string, number>();
  const output = new Map<string, number>();
  for (const event of events) {
    if (event.type === "turn.started") {
      currentByRun.set(event.runId, (currentByRun.get(event.runId) ?? 0) + 1);
    }
    output.set(event.id, currentByRun.get(event.runId) ?? 0);
  }
  return output;
}

function indexCalls(events: RunEvent[]): Map<string, number> {
  const output = new Map<string, number>();
  for (const event of events) {
    const key = callKey(event);
    if (key && !output.has(key)) output.set(key, output.size + 1);
  }
  return output;
}

function callKey(event: RunEvent): string | undefined {
  const payload = record(event.payload);
  if (typeof payload?.["callId"] === "string") {
    return `tool:${event.runId}:${payload["callId"]}`;
  }
  const turnIndex =
    number(payload?.["turnIndex"]) ??
    number(payload?.["modelContextEnvelopeTurnIndex"]);
  return turnIndex !== undefined &&
    (event.type.startsWith("context.model_") || event.type === "model.response")
    ? `model:${event.runId}:${String(turnIndex)}`
    : undefined;
}

function pairedStart(
  events: RunEvent[],
  event: RunEvent,
  key: string,
): boolean {
  return events.some(
    (candidate) =>
      candidate.seq < event.seq &&
      callKey(candidate) === key &&
      startEvent(candidate),
  );
}

function startEvent(event: RunEvent): boolean {
  return (
    event.type === "tool.started" || event.type === "context.model_envelope"
  );
}

function terminalEvent(event: RunEvent): boolean {
  return (
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "tool.blocked" ||
    event.type === "model.response"
  );
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
    event.type === "model.response" ||
    event.type === "tool.started" ||
    terminalEvent(event)
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
    event.type.startsWith("model.")
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
  return event.type
    .split(/[._]/u)
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");
}

function segmentStatus(event: RunEvent): TraceTrajectoryStatus {
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
    event.type === "model.response" ||
    event.type === "message.assistant"
  ) {
    return "completed";
  }
  return "neutral";
}

function timelineStart(events: RunEvent[], runs: readonly RunRecord[]): number {
  const values = [
    ...events.map((event) => timestamp(event.createdAt)),
    ...runs.map((run) => timestamp(run.startedAt)),
  ].filter(Number.isFinite);
  return values.length > 0 ? Math.min(...values) : 0;
}

function timelineEnd(
  events: RunEvent[],
  runs: readonly RunRecord[],
  start: number,
): number {
  const values = [
    ...events.map((event) => timestamp(event.createdAt)),
    ...runs.flatMap((run) =>
      run.finishedAt ? [timestamp(run.finishedAt)] : [],
    ),
  ].filter(Number.isFinite);
  return values.length > 0 ? Math.max(...values) : start + 1;
}

function boundedPosition(leftInput: number, widthInput: number) {
  const left = Math.min(99.2, Math.max(0, leftInput));
  const width = Math.min(100 - left, Math.max(0.8, widthInput));
  return { left, width };
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

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}
