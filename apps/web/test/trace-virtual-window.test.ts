import { describe, expect, it } from "vitest";

import type { TraceRunSemanticCollection } from "../src/trace-semantic-rows";
import {
  createTraceVirtualLayout,
  createTraceVirtualWindow,
  TRACE_VIRTUAL_VIEWPORT_PX,
} from "../src/trace-virtual-window";
import type { TraceTrajectoryEvent } from "../src/trace-trajectory-model";

describe("Trace virtual window", () => {
  it("bounds mounted rows at the start and end of a 100k collection", () => {
    const layout = createTraceVirtualLayout(collection(100_000));
    const first = createTraceVirtualWindow(
      layout,
      0,
      TRACE_VIRTUAL_VIEWPORT_PX,
    );
    const last = createTraceVirtualWindow(
      layout,
      layout.totalHeight,
      TRACE_VIRTUAL_VIEWPORT_PX,
    );

    expect(layout.totalRowCount).toBe(100_000);
    expect(layout.eventTopById.get("event_100000")).toBeGreaterThan(5_000_000);
    expect(first.mountedRowCount).toBeLessThanOrEqual(14);
    expect(last.mountedRowCount).toBeLessThanOrEqual(14);
    expect(last.items.at(-1)?.key).toBe("event:event_100000");
  });

  it("clamps invalid scroll offsets and keeps row indices stable", () => {
    const layout = createTraceVirtualLayout(collection(100));
    const before = createTraceVirtualWindow(layout, -100, 200, 0);
    const after = createTraceVirtualWindow(layout, Number.MAX_VALUE, 200, 0);

    expect(before.scrollTop).toBe(0);
    expect(after.scrollTop).toBe(layout.totalHeight - 200);
    const last = after.items.at(-1);
    expect(last?.kind).toBe("row");
    if (last?.kind !== "row") throw new Error("expected row");
    expect(last.row.rowIndex).toBe(100);
  });
});

function collection(count: number): TraceRunSemanticCollection {
  return {
    totalRowCount: count,
    turns: [
      {
        index: 1,
        eventCount: count,
        rows: Array.from({ length: count }, (_, index) => ({
          kind: "event" as const,
          key: `event:event_${String(index + 1)}`,
          rowIndex: index + 1,
          event: event(index + 1),
          exception: false,
        })),
      },
    ],
  };
}

function event(seq: number): TraceTrajectoryEvent {
  return {
    event: {
      id: `event_${String(seq)}`,
      threadId: "thread_scale",
      runId: "run_scale",
      seq,
      type: "message.assistant",
      category: "message",
      visibility: "user",
      createdAt: new Date(Date.UTC(2026, 7, 27) + seq).toISOString(),
      payload: {},
    },
    summary: "Assistant response recorded.",
    summarySource: "fixed",
    lane: "model",
    role: "ASSISTANT",
    label: "Assistant result",
    turnIndex: 1,
    timestampMs: Date.UTC(2026, 7, 27) + seq,
    status: "completed",
  };
}
