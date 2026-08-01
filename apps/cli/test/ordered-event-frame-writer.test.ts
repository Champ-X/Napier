import { Writable } from "node:stream";

import type { RunEvent, StreamFrame } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { OrderedEventFrameWriter } from "../src/ordered-event-frame-writer.js";

describe("ordered JSONL event writer", () => {
  it("streams concurrent arrivals in Ledger sequence order", async () => {
    const output = new CaptureWritable();
    const writer = new OrderedEventFrameWriter(output, "thread_jsonl_order", 1);

    await Promise.all([
      writer.write(event(2)),
      writer.write(event(1)),
      writer.write(event(4)),
      writer.write(event(3)),
    ]);
    await writer.finish(4);

    const frames = output
      .text()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as StreamFrame);
    expect(
      frames.map((frame) => (frame.type === "event" ? frame.event.seq : 0)),
    ).toEqual([1, 2, 3, 4]);
  });

  it("fills callback gaps from the authoritative terminal Ledger", async () => {
    const output = new CaptureWritable();
    const writer = new OrderedEventFrameWriter(output, "thread_jsonl_order", 1);

    await writer.write(event(1));
    await writer.write(event(3));
    await writer.finish(3, [event(1), event(2), event(3)]);

    const frames = output
      .text()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as StreamFrame);
    expect(
      frames.map((frame) => (frame.type === "event" ? frame.event.seq : 0)),
    ).toEqual([1, 2, 3]);
  });

  it("fails closed when terminal Ledger evidence conflicts or is incomplete", async () => {
    const conflict = new OrderedEventFrameWriter(
      new CaptureWritable(),
      "thread_jsonl_order",
      1,
    );
    await conflict.write(event(1));
    await expect(
      conflict.finish(1, [
        { ...event(1), payload: { text: "conflicting evidence" } },
      ]),
    ).rejects.toThrow(
      "JSONL event stream reconciliation conflicts with written evidence",
    );

    const incomplete = new OrderedEventFrameWriter(
      new CaptureWritable(),
      "thread_jsonl_order",
      1,
    );
    await incomplete.write(event(1));
    await expect(incomplete.finish(1, [])).rejects.toThrow(
      "JSONL event stream reconciliation is incomplete",
    );
  });

  it("fails closed on a gap or duplicate sequence", async () => {
    const missing = new OrderedEventFrameWriter(
      new CaptureWritable(),
      "thread_jsonl_order",
      1,
    );
    await missing.write(event(2));
    await expect(missing.finish(2)).rejects.toThrow(
      "JSONL event stream is incomplete",
    );

    const duplicate = new OrderedEventFrameWriter(
      new CaptureWritable(),
      "thread_jsonl_order",
      1,
    );
    await duplicate.write(event(1));
    await expect(duplicate.write(event(1))).rejects.toThrow(
      "JSONL event stream received invalid sequence",
    );
    await expect(duplicate.finish(1)).rejects.toThrow(
      "JSONL event stream received invalid sequence",
    );
  });
});

function event(seq: number): RunEvent {
  return {
    id: `event_jsonl_${String(seq)}`,
    threadId: "thread_jsonl_order",
    runId: "run_jsonl_order",
    seq,
    type: "model.text.delta",
    category: "model",
    visibility: "debug",
    createdAt: `2026-07-30T02:00:0${String(seq)}.000Z`,
    payload: { text: String(seq) },
  };
}

class CaptureWritable extends Writable {
  private readonly chunks: Buffer[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}
