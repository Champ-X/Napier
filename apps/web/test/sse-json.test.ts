import { describe, expect, it, vi } from "vitest";

import { readSseJsonRecords } from "../src/sse-json";

describe("shared SSE JSON reader", () => {
  it("preserves split UTF-8 code points and trailing records", async () => {
    const encoded = new TextEncoder().encode(
      'event: note\ndata: {"text":"evidence \u2713"}',
    );
    const split = encoded.findIndex((byte) => byte >= 0x80) + 1;
    const records = [];
    for await (const record of readSseJsonRecords(
      "/api/test",
      byteStream([encoded.slice(0, split), encoded.slice(split)]),
    )) {
      records.push(record);
    }
    expect(records).toEqual([
      expect.objectContaining({
        eventType: "note",
        value: { text: "evidence \u2713" },
      }),
    ]);
  });

  it("fails before buffering a response beyond its total limit", async () => {
    const stream = byteStream([
      new TextEncoder().encode(`data: "${"x".repeat(64)}"`),
    ]);
    const read = async (): Promise<void> => {
      for await (const _record of readSseJsonRecords("/api/test", stream, {
        maxTotalBytes: 16,
      })) {
        // The byte limit fails before a record can be yielded.
      }
    };
    await expect(read()).rejects.toThrow("exceeds its byte limit");
  });

  it("releases the reader after normal completion without cancelling the source", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"ok":true}\n\n'));
        controller.close();
      },
      cancel,
    });
    for await (const _record of readSseJsonRecords("/api/test", stream)) {
      // Drain the source normally.
    }
    expect(stream.locked).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each(["break", "consumer-error", "parse-error", "byte-limit"])(
    "cancels an open source and releases its reader on %s",
    async (failure) => {
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              failure === "parse-error" ? "data: invalid\n\n" : 'data: {"ok":true}\n\n',
            ),
          );
        },
        cancel,
      });
      const consume = async () => {
        for await (const _record of readSseJsonRecords("/api/test", stream, {
          ...(failure === "byte-limit" ? { maxTotalBytes: 1 } : {}),
        })) {
          if (failure === "consumer-error") throw new Error("Invalid protocol frame");
          break;
        }
      };
      if (failure === "break") await consume();
      else await expect(consume()).rejects.toThrow();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(stream.locked).toBe(false);
    },
  );

  it("preserves the original failure when source cancellation also fails", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"ok":true}\n\n'));
      },
      cancel() {
        throw new Error("Cancellation failed");
      },
    });
    const consume = async () => {
      for await (const _record of readSseJsonRecords("/api/test", stream)) {
        throw new Error("Invalid protocol frame");
      }
    };
    await expect(consume()).rejects.toThrow("Invalid protocol frame");
    expect(stream.locked).toBe(false);
  });
});

function byteStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}
