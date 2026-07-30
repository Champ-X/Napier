import { describe, expect, it } from "vitest";

import {
  DapMessageDecoder,
  encodeDapRequest,
  MAX_DAP_MESSAGE_BYTES,
  MAX_DAP_PROTOCOL_BYTES,
} from "../src/dap-protocol.js";

describe("DAP framing", () => {
  it("encodes requests and decodes fragmented and coalesced UTF-8 frames", () => {
    expect(
      encodeDapRequest({
        seq: 1,
        type: "request",
        command: "stackTrace",
        arguments: { threadId: 1 },
      }),
    ).toBe(
      'Content-Length: 76\r\n\r\n{"seq":1,"type":"request","command":"stackTrace","arguments":{"threadId":1}}',
    );

    const response = frame({
      seq: 2,
      type: "response",
      request_seq: 1,
      success: true,
      command: "evaluate",
      body: { result: "résultat" },
    });
    const event = frame({
      seq: 3,
      type: "event",
      event: "stopped",
      body: { reason: "breakpoint" },
    });
    const decoder = new DapMessageDecoder();

    expect(decoder.push(response.slice(0, 17))).toEqual([]);
    expect(decoder.push(response.slice(17) + event)).toEqual([
      expect.objectContaining({
        type: "response",
        command: "evaluate",
        body: { result: "résultat" },
      }),
      expect.objectContaining({
        type: "event",
        event: "stopped",
        body: { reason: "breakpoint" },
      }),
    ]);
  });

  it("rejects malformed, oversized, and structurally ambiguous frames", () => {
    expect(() =>
      new DapMessageDecoder().push('Content-Length: 01\r\n\r\n{"seq":1}'),
    ).toThrow("header is invalid");
    expect(() =>
      new DapMessageDecoder().push(
        frame({
          seq: 1,
          type: "event",
          event: "stopped",
          body: {},
          injected: true,
        }),
      ),
    ).toThrow("DAP event is invalid");
    expect(() =>
      new DapMessageDecoder().push(
        "Content-Length: 1\r\nX-Extra: yes\r\n\r\n{}",
      ),
    ).toThrow("header is invalid");
    expect(() =>
      new DapMessageDecoder().push("x".repeat(MAX_DAP_PROTOCOL_BYTES + 1)),
    ).toThrow("total limit");
    expect(() =>
      encodeDapRequest({
        seq: 1,
        type: "request",
        command: "evaluate",
        arguments: { expression: "x".repeat(MAX_DAP_MESSAGE_BYTES) },
      }),
    ).toThrow("message limit");
    expect(() =>
      encodeDapRequest({
        seq: 1,
        type: "request",
        command: "bad\ncommand",
      }),
    ).toThrow("request is invalid");
  });
});

function frame(value: Record<string, unknown>): string {
  const body = JSON.stringify(value);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}
