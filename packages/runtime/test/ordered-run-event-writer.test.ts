import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { OrderedRunEventWriter } from "../src/ordered-run-event-writer.js";

describe("OrderedRunEventWriter", () => {
  it("buffers out-of-order callbacks and writes contiguous Ledger sequence", async () => {
    const written: number[] = [];
    const writer = new OrderedRunEventWriter(
      "thread_ordered",
      2,
      async (event) => {
        written.push(event.seq);
      },
    );

    await writer.write(event(3));
    expect(written).toEqual([]);
    await Promise.all([writer.write(event(4)), writer.write(event(2))]);
    await writer.finish(4);
    expect(written).toEqual([2, 3, 4]);
  });

  it("fails closed on duplicates, foreign Threads, and incomplete streams", async () => {
    const duplicate = new OrderedRunEventWriter(
      "thread_ordered",
      1,
      async () => undefined,
    );
    await duplicate.write(event(2));
    await expect(duplicate.write(event(2))).rejects.toThrow("invalid sequence");

    const foreign = new OrderedRunEventWriter(
      "thread_ordered",
      1,
      async () => undefined,
    );
    await expect(
      foreign.write({ ...event(1), threadId: "thread_foreign" }),
    ).rejects.toThrow("invalid sequence");

    const incomplete = new OrderedRunEventWriter(
      "thread_ordered",
      1,
      async () => undefined,
    );
    await incomplete.write(event(2));
    await expect(incomplete.finish(2)).rejects.toThrow("incomplete");
  });
});

function event(seq: number): RunEvent {
  return {
    id: `event_${String(seq).padStart(3, "0")}`,
    threadId: "thread_ordered",
    runId: "run_ordered",
    seq,
    type: "test.event",
    category: "system",
    visibility: "debug",
    createdAt: "2026-07-31T00:00:00.000Z",
    payload: { seq },
  };
}
