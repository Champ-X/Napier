import type { RunEvent, RunRecord } from "@napier/contracts";

import {
  traceTrajectoryCallKey,
  traceTrajectoryStartEvent,
  traceTrajectoryTerminalEvent,
} from "./trace-trajectory-events";

export interface TraceTrajectoryCallPairs {
  pairedTerminalIds: Set<string>;
  terminalByCall: Map<string, RunEvent>;
}

export interface TraceTrajectorySourceIndex {
  callOrdinalByKey: Map<string, number>;
  callPairs: TraceTrajectoryCallPairs;
  endedAtMs: number;
  runIds: string[];
  startedAtMs: number;
  turnCount: number;
  turnIndexByEvent: Map<string, number>;
}

export interface TraceTrajectoryIndexableEvent {
  event: RunEvent;
  lane: string;
}

export interface TraceTrajectoryEventIndex<
  Event extends TraceTrajectoryIndexableEvent = TraceTrajectoryIndexableEvent,
> {
  byCall: Map<string, Event[]>;
  byId: Map<string, Event>;
  byLane: Map<Event["lane"], Event[]>;
  byRun: Map<string, Event[]>;
  bySeq: Map<number, Event>;
  byType: Map<string, Event[]>;
}

export function createTraceTrajectorySourceIndex(
  events: readonly RunEvent[],
  runs: readonly RunRecord[],
): TraceTrajectorySourceIndex {
  const callOrdinalByKey = new Map<string, number>();
  const currentTurnByRun = new Map<string, number>();
  const pairedTerminalIds = new Set<string>();
  const runStartedAt = new Map<string, string>();
  const runIds = new Set<string>();
  const startedCalls = new Set<string>();
  const terminalByCall = new Map<string, RunEvent>();
  const turnIndexByEvent = new Map<string, number>();
  let endedAtMs = Number.NEGATIVE_INFINITY;
  let startedAtMs = Number.POSITIVE_INFINITY;
  let turnCount = 0;

  for (const run of runs) {
    runIds.add(run.id);
    runStartedAt.set(run.id, run.startedAt);
    startedAtMs = Math.min(startedAtMs, timestamp(run.startedAt));
    if (run.finishedAt)
      endedAtMs = Math.max(endedAtMs, timestamp(run.finishedAt));
  }
  for (const event of events) {
    runIds.add(event.runId);
    if (!runStartedAt.has(event.runId)) {
      runStartedAt.set(event.runId, event.createdAt);
    }
    const eventTimestamp = timestamp(event.createdAt);
    startedAtMs = Math.min(startedAtMs, eventTimestamp);
    endedAtMs = Math.max(endedAtMs, eventTimestamp);
    if (event.type === "turn.started") {
      const nextTurn = (currentTurnByRun.get(event.runId) ?? 0) + 1;
      currentTurnByRun.set(event.runId, nextTurn);
      turnCount = Math.max(turnCount, nextTurn);
    }
    turnIndexByEvent.set(event.id, currentTurnByRun.get(event.runId) ?? 0);

    const callKey = traceTrajectoryCallKey(event);
    if (!callKey) continue;
    if (!callOrdinalByKey.has(callKey)) {
      callOrdinalByKey.set(callKey, callOrdinalByKey.size + 1);
    }
    if (traceTrajectoryStartEvent(event)) startedCalls.add(callKey);
    if (!traceTrajectoryTerminalEvent(event)) continue;
    terminalByCall.set(callKey, event);
    if (startedCalls.has(callKey)) pairedTerminalIds.add(event.id);
  }

  const orderedRunIds = [...runIds].sort((left, right) =>
    (runStartedAt.get(left) ?? "").localeCompare(runStartedAt.get(right) ?? ""),
  );
  const start = Number.isFinite(startedAtMs) ? startedAtMs : 0;
  return {
    callOrdinalByKey,
    callPairs: { pairedTerminalIds, terminalByCall },
    endedAtMs: Number.isFinite(endedAtMs) ? endedAtMs : start + 1,
    runIds: orderedRunIds,
    startedAtMs: start,
    turnCount,
    turnIndexByEvent,
  };
}

export function createTraceTrajectoryEventIndex<
  Event extends TraceTrajectoryIndexableEvent,
>(events: readonly Event[]): TraceTrajectoryEventIndex<Event> {
  const index: TraceTrajectoryEventIndex<Event> = {
    byCall: new Map(),
    byId: new Map(),
    byLane: new Map(),
    byRun: new Map(),
    bySeq: new Map(),
    byType: new Map(),
  };
  for (const event of events) {
    index.byId.set(event.event.id, event);
    index.bySeq.set(event.event.seq, event);
    append(index.byRun, event.event.runId, event);
    append(index.byType, event.event.type, event);
    append(index.byLane, event.lane, event);
    const callKey = traceTrajectoryCallKey(event.event);
    if (callKey) append(index.byCall, callKey, event);
  }
  return index;
}

function append<Key, Value>(
  index: Map<Key, Value[]>,
  key: Key,
  event: Value,
): void {
  const values = index.get(key);
  if (values) values.push(event);
  else index.set(key, [event]);
}

function timestamp(value: string): number {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : 0;
}
