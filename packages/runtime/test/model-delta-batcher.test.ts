import type { RunEvent } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelDeltaBatcher } from "../src/model-delta-batcher.js";
import { RunEventAdmissionError } from "../src/run-event-admission.js";
import type { AppendEventInput } from "../src/store.js";

describe("Model delta batching", () => {
  afterEach(() => vi.useRealTimers());

  it("coalesces tiny thinking deltas into one hash-only Ledger event", async () => {
    const recorded: AppendEventInput[] = [];
    const streamed: RunEvent[] = [];
    const batcher = fixture(recorded, streamed);

    for (let index = 0; index < 1_000; index += 1) {
      await batcher.push("model.thinking.delta", "思", true);
    }
    await batcher.flush();

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual(
      expect.objectContaining({
        type: "model.thinking.delta",
        payload: {
          chunkCount: 1_000,
          deltaBytes: 3_000,
          deltaSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          redacted: true,
        },
      }),
    );
    expect(JSON.stringify(recorded)).not.toContain("思");
    expect(streamed).toEqual([]);
  });

  it("flushes text by latency while preserving the exact stream text", async () => {
    const recorded: AppendEventInput[] = [];
    const streamed: RunEvent[] = [];
    let now = 0;
    const batcher = fixture(recorded, streamed, () => now);

    await batcher.push("model.text.delta", "Hel", false);
    now = 50;
    await batcher.push("model.text.delta", "lo", false);
    now = 100;
    await batcher.push("model.text.delta", " world", false);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.payload).toEqual({
      chunkCount: 3,
      deltaBytes: 11,
      delta: "Hello world",
    });
    expect(streamed).toHaveLength(1);
  });

  it("flushes before switching delta types", async () => {
    const recorded: AppendEventInput[] = [];
    const batcher = fixture(recorded, []);

    await batcher.push("model.thinking.delta", "reason", false);
    await batcher.push("model.text.delta", "answer", false);
    await batcher.flush();

    expect(recorded.map((event) => event.type)).toEqual([
      "model.thinking.delta",
      "model.text.delta",
    ]);
    expect(recorded.map((event) => event.payload)).toEqual([
      { chunkCount: 1, deltaBytes: 6, delta: "reason" },
      { chunkCount: 1, deltaBytes: 6, delta: "answer" },
    ]);
  });

  it("flushes sparse text on the real-time latency boundary", async () => {
    vi.useFakeTimers();
    const recorded: AppendEventInput[] = [];
    const batcher = fixture(recorded, []);

    await batcher.push("model.text.delta", "live", false);
    expect(recorded).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    await batcher.flush();

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.payload).toEqual({
      chunkCount: 1,
      deltaBytes: 4,
      delta: "live",
    });
  });

  it("discards a pending batch rejected after Run termination", async () => {
    const attempted: AppendEventInput[] = [];
    const batcher = new ModelDeltaBatcher(
      "thread_delta",
      "run_delta",
      async (input) => {
        attempted.push(input);
        throw new RunEventAdmissionError("completed");
      },
    );

    await batcher.push("model.text.delta", "late", false);
    await expect(batcher.flush()).resolves.toBeUndefined();
    await expect(batcher.flush()).resolves.toBeUndefined();

    expect(attempted).toEqual([
      expect.objectContaining({
        type: "model.text.delta",
        admission: "run_active",
      }),
    ]);
  });

  it("retains a pending batch after an unrelated persistence failure", async () => {
    const attempted: AppendEventInput[] = [];
    let fail = true;
    const batcher = new ModelDeltaBatcher(
      "thread_delta",
      "run_delta",
      async (input) => {
        attempted.push(input);
        if (fail) throw new Error("disk unavailable");
        return event(input, attempted.length);
      },
    );

    await batcher.push("model.text.delta", "retry", false);
    await expect(batcher.flush()).rejects.toThrow("disk unavailable");
    fail = false;
    await expect(batcher.flush()).resolves.toBeUndefined();

    expect(attempted).toHaveLength(2);
    expect(attempted[1]?.payload).toEqual({
      chunkCount: 1,
      deltaBytes: 5,
      delta: "retry",
    });
  });
});

function fixture(
  recorded: AppendEventInput[],
  streamed: RunEvent[],
  now?: () => number,
): ModelDeltaBatcher {
  let seq = 0;
  return new ModelDeltaBatcher(
    "thread_delta",
    "run_delta",
    async (input, onEvent) => {
      recorded.push(input);
      const recordedEvent = event(input, ++seq);
      await onEvent?.(recordedEvent);
      if (onEvent) streamed.push(recordedEvent);
      return recordedEvent;
    },
    async () => undefined,
    now,
  );
}

function event(input: AppendEventInput, seq: number): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: input.threadId,
    runId: input.runId,
    type: input.type,
    category: input.category,
    visibility: input.visibility ?? "debug",
    payload: input.payload,
    seq,
    createdAt: "2026-08-16T00:00:00.000Z",
  };
}
