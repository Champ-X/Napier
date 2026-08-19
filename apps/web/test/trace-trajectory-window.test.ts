import { describe, expect, it } from "vitest";

import type {
  TraceTrajectoryEvent,
  TraceTrajectoryTurn,
} from "../src/trace-trajectory-model";
import { traceTurnWindow } from "../src/TraceTrajectoryLedger";

describe("Trajectory incremental window", () => {
  it("keeps the newest bounded events while preserving turn groups", () => {
    const turns = [turn(1, 120), turn(2, 120), turn(3, 120)];
    const visible = traceTurnWindow(turns, 180);

    expect(visible.map((item) => [item.index, item.events.length])).toEqual([
      [2, 60],
      [3, 120],
    ]);
    expect(visible.flatMap((item) => item.events)).toHaveLength(180);
  });
});

function turn(index: number, count: number): TraceTrajectoryTurn {
  return {
    index,
    label: `Turn ${String(index)}`,
    events: Array.from(
      { length: count },
      (_, eventIndex) =>
        ({
          event: { id: `event_${String(index)}_${String(eventIndex)}` },
        }) as unknown as TraceTrajectoryEvent,
    ),
  };
}
