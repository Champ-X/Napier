import { describe, expect, it } from "vitest";

import {
  buildTraceRunSemanticView,
  foldTurnEvents,
  TRACE_SEMANTIC_ROW_BUDGET,
  type TraceSemanticRow,
} from "../src/trace-semantic-rows";
import type {
  TraceTrajectoryEvent,
  TraceTrajectoryStatus,
  TraceTrajectoryTurn,
} from "../src/trace-trajectory-model";

describe("foldTurnEvents", () => {
  it("folds runs of adjacent low-value events into one summary row", () => {
    const rows = foldTurnEvents([
      keyEvent(1),
      lowValueEvent(2, "model"),
      lowValueEvent(3, "tools"),
      lowValueEvent(4, "tools"),
      keyEvent(5),
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["event", "fold", "event"]);
    const fold = rows[1];
    if (fold?.kind !== "fold") throw new Error("expected fold row");
    expect(fold.count).toBe(3);
    expect(fold.laneCounts).toEqual({ input: 0, model: 1, tools: 2 });
    expect(fold.startMs).toBeLessThanOrEqual(fold.endMs);
  });

  it("keeps a lone low-value event as its own row rather than folding", () => {
    const rows = foldTurnEvents([
      keyEvent(1),
      lowValueEvent(2, "model"),
      keyEvent(3),
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["event", "event", "event"]);
  });

  it("never folds exception events and marks them", () => {
    const rows = foldTurnEvents([
      lowValueEvent(1, "tools"),
      failedEvent(2),
      lowValueEvent(3, "tools"),
    ]);

    const exception = rows.find(
      (row): row is Extract<TraceSemanticRow, { kind: "event" }> =>
        row.kind === "event" && row.exception,
    );
    expect(exception?.event.event.id).toBe("event_2");
  });

  it("keeps the selected event individual even inside a fold run", () => {
    const rows = foldTurnEvents(
      [
        lowValueEvent(1, "model"),
        lowValueEvent(2, "model"),
        lowValueEvent(3, "model"),
        lowValueEvent(4, "model"),
      ],
      2,
      "event_3",
    );

    expect(rows.map((row) => row.kind)).toEqual(["fold", "event", "event"]);
    const selected = rows[1];
    if (selected?.kind !== "event") throw new Error("expected event row");
    expect(selected.event.event.id).toBe("event_3");
  });
});

describe("buildTraceRunSemanticView", () => {
  it("groups rows under their turns and reports the source event count", () => {
    const view = buildTraceRunSemanticView([
      turn(1, [keyEvent(1), keyEvent(2)]),
      turn(2, [keyEvent(3)]),
    ]);

    expect(view.turns.map((turnView) => turnView.index)).toEqual([1, 2]);
    expect(view.turns[0]?.eventCount).toBe(2);
    expect(view.turns[0]?.rows).toHaveLength(2);
    expect(view.turns[1]?.rows).toHaveLength(1);
    expect(view.totalRowCount).toBe(3);
    expect(view.hiddenRowCount).toBe(0);
  });

  it("assigns stable 1-based row indices across the full collection", () => {
    const view = buildTraceRunSemanticView([
      turn(1, [keyEvent(1), keyEvent(2)]),
      turn(2, [keyEvent(3)]),
    ]);

    const indices = view.turns.flatMap((turnView) =>
      turnView.rows.map((row) => row.rowIndex),
    );
    expect(indices).toEqual([1, 2, 3]);
  });

  it("caps mounted rows at the budget and keeps the newest rows", () => {
    const events = Array.from({ length: 80 }, (_, index) =>
      keyEvent(index + 1),
    );
    const view = buildTraceRunSemanticView([turn(1, events)], { maxRows: 60 });

    expect(view.mountedRowCount).toBe(60);
    expect(view.totalRowCount).toBe(80);
    expect(view.hiddenRowCount).toBe(20);
    expect(view.hiddenEventCount).toBe(20);
    const rows = view.turns.flatMap((turnView) => turnView.rows);
    expect(rows[0]?.rowIndex).toBe(21);
    const lastRow = rows.at(-1);
    if (lastRow?.kind !== "event") throw new Error("expected event row");
    expect(lastRow.event.event.id).toBe("event_80");
  });

  it("counts folded raw events toward the hidden event total", () => {
    const view = buildTraceRunSemanticView(
      [
        turn(1, [
          keyEvent(1),
          lowValueEvent(2, "tools"),
          lowValueEvent(3, "tools"),
          lowValueEvent(4, "tools"),
          keyEvent(5),
          keyEvent(6),
        ]),
      ],
      { maxRows: 2 },
    );

    // Full rows: event(1), fold(3), event(5), event(6). Kept newest 2.
    expect(view.mountedRowCount).toBe(2);
    expect(view.hiddenEventCount).toBe(4);
  });

  it("defaults the row budget to 60", () => {
    expect(TRACE_SEMANTIC_ROW_BUDGET).toBe(60);
  });
});

function turn(
  index: number,
  events: TraceTrajectoryEvent[],
): TraceTrajectoryTurn {
  return { index, label: `Turn ${String(index)}`, events };
}

function keyEvent(seq: number): TraceTrajectoryEvent {
  return baseEvent(seq, "message.assistant", "model", "completed");
}

function failedEvent(seq: number): TraceTrajectoryEvent {
  return baseEvent(seq, "tool.failed", "tools", "failed");
}

function lowValueEvent(
  seq: number,
  lane: TraceTrajectoryEvent["lane"],
): TraceTrajectoryEvent {
  return baseEvent(seq, "context.prepared", lane, "neutral");
}

function baseEvent(
  seq: number,
  type: string,
  lane: TraceTrajectoryEvent["lane"],
  status: TraceTrajectoryStatus,
): TraceTrajectoryEvent {
  return {
    event: {
      id: `event_${String(seq)}`,
      threadId: "thread_semantic",
      runId: "run_semantic",
      seq,
      type,
      category: "model",
      visibility: "user",
      createdAt: new Date(
        Date.parse("2026-08-24T00:00:00.000Z") + seq * 1_000,
      ).toISOString(),
      payload: {},
    },
    summary: `event ${String(seq)}`,
    summarySource: "fixed",
    lane,
    role: "MODEL",
    label: `Event ${String(seq)}`,
    turnIndex: 1,
    timestampMs: Date.parse("2026-08-24T00:00:00.000Z") + seq * 1_000,
    status,
  };
}
