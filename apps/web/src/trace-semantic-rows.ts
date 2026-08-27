import {
  traceTrajectoryIsKeyEvent,
  type TraceTrajectoryEvent,
  type TraceTrajectoryLane,
  type TraceTrajectoryTurn,
} from "./trace-trajectory-model";

/**
 * Trajectory semantic rows and bounded windowing (design §9.4, §14.1).
 *
 * The default trajectory view must stay within a mounted-row budget instead of
 * dumping every raw event. Key events, exceptions, and the selected event stay
 * individual; runs of adjacent low-value events fold into a single summary row
 * that reports how many events and which time range they cover — never a
 * fabricated duration. When the folded set still exceeds the budget the oldest
 * rows are dropped from the DOM while `aria-rowindex`/`aria-rowcount` keep the
 * full collection size, so assistive tech and the "show earlier" affordance
 * both stay accurate. This module is side-effect free for unit testing.
 */
export type TraceSemanticRow = TraceSemanticEventRow | TraceSemanticFoldRow;

export interface TraceSemanticEventRow {
  kind: "event";
  key: string;
  /** 1-based position within the full (uncapped) row collection. */
  rowIndex: number;
  event: TraceTrajectoryEvent;
  exception: boolean;
}

export interface TraceSemanticFoldRow {
  kind: "fold";
  key: string;
  /** 1-based position within the full (uncapped) row collection. */
  rowIndex: number;
  count: number;
  startMs: number;
  endMs: number;
  laneCounts: Record<TraceTrajectoryLane, number>;
}

export interface TraceRunSemanticTurn {
  index: number;
  /** Raw event count of the source turn, shown in the turn header. */
  eventCount: number;
  rows: TraceSemanticRow[];
}

export interface TraceRunSemanticView {
  turns: TraceRunSemanticTurn[];
  /** Rows currently mounted in the DOM (event + fold). */
  mountedRowCount: number;
  /** Rows in the full collection before the budget was applied. */
  totalRowCount: number;
  /** Rows dropped by the budget. */
  hiddenRowCount: number;
  /** Raw events represented by the dropped rows. */
  hiddenEventCount: number;
}

export interface TraceRunSemanticCollection {
  turns: TraceRunSemanticTurn[];
  totalRowCount: number;
}

export interface TraceRunSemanticOptions {
  /** Hard cap on mounted semantic rows; the newest rows are kept. */
  maxRows?: number;
  /** Minimum run of adjacent low-value events before they fold. */
  minFoldRun?: number;
  /** Selected event stays individual and is never folded away. */
  selectedEventId?: string | undefined;
}

export const TRACE_SEMANTIC_ROW_BUDGET = 60;
const DEFAULT_MIN_FOLD_RUN = 2;

interface TaggedRow {
  turnIndex: number;
  row: TraceSemanticRow;
}

/**
 * Builds the turn-grouped, budget-capped semantic view for one run's turns.
 */
export function buildTraceRunSemanticView(
  turns: readonly TraceTrajectoryTurn[],
  options: TraceRunSemanticOptions = {},
): TraceRunSemanticView {
  const maxRows = Math.max(1, options.maxRows ?? TRACE_SEMANTIC_ROW_BUDGET);
  const collection = buildTraceRunSemanticCollection(turns, options);
  const flat = collection.turns.flatMap((turn) =>
    turn.rows.map((row) => ({ turnIndex: turn.index, row })),
  );
  const totalRowCount = collection.totalRowCount;
  const hiddenRowCount = Math.max(0, totalRowCount - maxRows);
  const dropped = flat.slice(0, hiddenRowCount);
  const kept = flat.slice(hiddenRowCount);
  const hiddenEventCount = dropped.reduce(
    (total, entry) => total + rawCount(entry.row),
    0,
  );

  return {
    turns: groupTaggedRows(kept, collection.turns, hiddenRowCount),
    mountedRowCount: kept.length,
    totalRowCount,
    hiddenRowCount,
    hiddenEventCount,
  };
}

export function buildTraceRunSemanticCollection(
  turns: readonly TraceTrajectoryTurn[],
  options: Omit<TraceRunSemanticOptions, "maxRows"> = {},
): TraceRunSemanticCollection {
  const minFoldRun = Math.max(2, options.minFoldRun ?? DEFAULT_MIN_FOLD_RUN);
  const eventCountByTurn = new Map<number, number>();
  const flat: TaggedRow[] = [];

  for (const turn of turns) {
    if (turn.events.length === 0) continue;
    eventCountByTurn.set(turn.index, turn.events.length);
    for (const row of foldTurnEvents(
      turn.events,
      minFoldRun,
      options.selectedEventId,
    )) {
      flat.push({ turnIndex: turn.index, row });
    }
  }

  return {
    turns: groupTaggedRows(
      flat,
      [...eventCountByTurn].map(([index, eventCount]) => ({
        index,
        eventCount,
      })),
      0,
    ),
    totalRowCount: flat.length,
  };
}

function groupTaggedRows(
  entries: readonly TaggedRow[],
  sourceTurns: readonly Pick<TraceRunSemanticTurn, "index" | "eventCount">[],
  rowIndexOffset: number,
): TraceRunSemanticTurn[] {
  const eventCountByTurn = new Map(
    sourceTurns.map((turn) => [turn.index, turn.eventCount]),
  );
  const output: TraceRunSemanticTurn[] = [];
  for (const [offset, entry] of entries.entries()) {
    const indexedRow = { ...entry.row, rowIndex: rowIndexOffset + offset + 1 };
    const last = output.at(-1);
    if (last && last.index === entry.turnIndex) last.rows.push(indexedRow);
    else {
      output.push({
        index: entry.turnIndex,
        eventCount: eventCountByTurn.get(entry.turnIndex) ?? 0,
        rows: [indexedRow],
      });
    }
  }
  return output;
}

/**
 * Folds one turn's events into event/fold rows without applying the row budget.
 * Exposed for focused unit tests and reuse by the run-view builder.
 */
export function foldTurnEvents(
  events: readonly TraceTrajectoryEvent[],
  minFoldRun = DEFAULT_MIN_FOLD_RUN,
  selectedEventId?: string,
): TraceSemanticRow[] {
  const rows: TraceSemanticRow[] = [];
  let pending: TraceTrajectoryEvent[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    if (pending.length >= Math.max(2, minFoldRun)) {
      rows.push(foldRow(pending));
    } else {
      for (const event of pending) rows.push(eventRow(event));
    }
    pending = [];
  };
  for (const event of events) {
    if (isImportantEvent(event, selectedEventId)) {
      flush();
      rows.push(eventRow(event));
    } else {
      pending.push(event);
    }
  }
  flush();
  return rows;
}

function rawCount(row: TraceSemanticRow): number {
  return row.kind === "fold" ? row.count : 1;
}

function isImportantEvent(
  event: TraceTrajectoryEvent,
  selectedEventId: string | undefined,
): boolean {
  return (
    event.status === "failed" ||
    event.event.id === selectedEventId ||
    traceTrajectoryIsKeyEvent(event)
  );
}

function eventRow(event: TraceTrajectoryEvent): TraceSemanticEventRow {
  return {
    kind: "event",
    key: `event:${event.event.id}`,
    rowIndex: 0,
    event,
    exception: event.status === "failed",
  };
}

function foldRow(events: TraceTrajectoryEvent[]): TraceSemanticFoldRow {
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  const laneCounts: Record<TraceTrajectoryLane, number> = {
    input: 0,
    model: 0,
    tools: 0,
  };
  for (const event of events) {
    laneCounts[event.lane] += 1;
    startMs = Math.min(startMs, event.timestampMs);
    endMs = Math.max(endMs, event.timestampMs);
  }
  return {
    kind: "fold",
    key: `fold:${events[0]!.event.id}:${events.at(-1)!.event.id}`,
    rowIndex: 0,
    count: events.length,
    startMs,
    endMs,
    laneCounts,
  };
}
