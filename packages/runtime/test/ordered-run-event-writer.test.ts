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

  it("reconciles missing indirect Ledger events against callback evidence", async () => {
    const written: number[] = [];
    const writer = new OrderedRunEventWriter(
      "thread_ordered",
      2,
      async (value) => {
        written.push(value.seq);
      },
    );
    const callbackEvent = {
      ...event(2),
      payload: { seq: 2, source: "callback" },
    };
    const authoritativeEvent = {
      ...callbackEvent,
      payload: { source: "callback", seq: 2 },
    };

    await writer.write(callbackEvent);
    await writer.write(event(4));
    await writer.reconcile([event(1), authoritativeEvent, event(3), event(4)]);
    await writer.finish(4);

    expect(written).toEqual([2, 3, 4]);
  });

  it("fails closed on conflicting or incomplete reconciliation", async () => {
    const writtenConflict = new OrderedRunEventWriter(
      "thread_ordered",
      1,
      async () => undefined,
    );
    await writtenConflict.write(event(1));
    await expect(
      writtenConflict.reconcile([
        { ...event(1), payload: { seq: 1, tampered: true } },
      ]),
    ).rejects.toThrow("conflicts with written evidence");
    await expect(writtenConflict.finish(1)).rejects.toThrow(
      "conflicts with written evidence",
    );

    const pendingConflict = new OrderedRunEventWriter(
      "thread_ordered",
      1,
      async () => undefined,
    );
    await pendingConflict.write(event(2));
    await expect(
      pendingConflict.reconcile([
        event(1),
        { ...event(2), payload: { seq: 2, tampered: true } },
      ]),
    ).rejects.toThrow("conflicts with pending evidence");

    const incomplete = new OrderedRunEventWriter(
      "thread_ordered",
      1,
      async () => undefined,
    );
    await incomplete.write(event(1));
    await expect(incomplete.reconcile([])).rejects.toThrow(
      "reconciliation is incomplete",
    );

    const gapped = new OrderedRunEventWriter(
      "thread_ordered",
      1,
      async () => undefined,
    );
    await expect(gapped.reconcile([event(2)])).rejects.toThrow(
      "reconciliation is incomplete",
    );
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
