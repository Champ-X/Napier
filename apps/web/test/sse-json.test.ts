import { describe, expect, it } from "vitest";

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
});

function byteStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}
