import { Readable, Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  MAX_RPC_LINE_BYTES,
  parseAgentResumeParams,
  parseAgentRunParams,
  parseInitializeParams,
  parseJsonRpcMessage,
  rpcError,
} from "../src/rpc-protocol.js";
import { readRpcLines, RpcOutputWriter } from "../src/rpc-transport.js";

describe("Napier JSON-RPC protocol", () => {
  it("strictly parses requests, notifications, and initialization", () => {
    expect(
      parseJsonRpcMessage(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"test","version":"1"}}}',
      ),
    ).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "test", version: "1" } },
    });
    expect(
      parseJsonRpcMessage(
        '{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":"run-1"}}',
      ),
    ).toEqual({
      jsonrpc: "2.0",
      method: "$/cancelRequest",
      params: { id: "run-1" },
    });
    expect(parseInitializeParams({ clientInfo: { name: "editor" } })).toEqual({
      clientInfo: { name: "editor" },
    });
    expect(() => parseJsonRpcMessage("{")).toThrow("not valid JSON");
    expect(() =>
      parseJsonRpcMessage('{"jsonrpc":"2.0","id":null,"method":"initialize"}'),
    ).toThrow("shape is invalid");
    expect(() =>
      parseJsonRpcMessage(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","extra":true}',
      ),
    ).toThrow("shape is invalid");
    expect(() =>
      parseInitializeParams({ clientInfo: { name: "x", extra: true } }),
    ).toThrow("unknown fields");
  });

  it("validates Agent run and resume params before Runtime mutation", () => {
    expect(
      parseAgentRunParams({
        prompt: "Inspect this workspace.",
        title: "RPC task",
        model: { provider: "napier", id: "demo" },
      }),
    ).toEqual({
      prompt: "Inspect this workspace.",
      title: "RPC task",
      model: { provider: "napier", id: "demo" },
    });
    expect(
      parseAgentResumeParams({
        threadId: "thread_example",
        runId: "run_abcdefgh",
      }),
    ).toEqual({
      threadId: "thread_example",
      runId: "run_abcdefgh",
    });
    expect(() =>
      parseAgentRunParams({
        prompt: "x",
        threadId: "thread_example",
        title: "conflict",
      }),
    ).toThrow("title cannot");
    expect(() => parseAgentRunParams({ prompt: "x", unknown: true })).toThrow(
      "unknown fields",
    );
    expect(() =>
      parseAgentRunParams({
        prompt: "x",
        model: { provider: "INVALID", id: "demo" },
      }),
    ).toThrow("model is invalid");
    expect(() =>
      parseAgentResumeParams({ threadId: "thread_example", runId: "bad" }),
    ).toThrow("runId is invalid");
  });

  it("frames split CRLF input and rejects oversized or invalid UTF-8 lines", async () => {
    const lines = await collectLines(
      Readable.from([
        Buffer.from('{"jsonrpc":"2.0",'),
        Buffer.from('"id":1,"method":"initialize"}\r\n'),
        Buffer.from(
          '{"jsonrpc":"2.0","method":"exit"}\n{"jsonrpc":"2.0","method":"tail"}',
        ),
      ]),
    );
    expect(lines).toEqual([
      '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
      '{"jsonrpc":"2.0","method":"exit"}',
      '{"jsonrpc":"2.0","method":"tail"}',
    ]);
    await expect(
      collectLines(Readable.from([Buffer.alloc(MAX_RPC_LINE_BYTES + 1, 0x61)])),
    ).rejects.toThrow("byte limit");
    await expect(
      collectLines(Readable.from([Buffer.from([0xc3, 0x28, 0x0a])])),
    ).rejects.toThrow("UTF-8");
  });

  it("releases the input iterator after a framing failure", async () => {
    let released = false;
    const input: AsyncIterable<Buffer> = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return {
              done: false as const,
              value: Buffer.alloc(MAX_RPC_LINE_BYTES + 1, 0x61),
            };
          },
          async return() {
            released = true;
            return { done: true as const, value: undefined };
          },
        };
      },
    };

    await expect(collectLines(input)).rejects.toThrow("byte limit");
    expect(released).toBe(true);
  });

  it("serializes output with backpressure and hashes private errors", async () => {
    const output = new CaptureWritable();
    const writer = new RpcOutputWriter(output);
    await Promise.all([
      writer.write({ id: 1 }),
      writer.write({ id: 2 }),
      writer.write(rpcError(3, -32603, "Internal error", "PRIVATE_FAILURE")),
    ]);
    await writer.close();

    const values = output
      .text()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(values.map((value) => value["id"])).toEqual([1, 2, 3]);
    expect(output.text()).not.toContain("PRIVATE_FAILURE");
    expect(output.text()).toMatch(/[a-f0-9]{64}/u);
  });
});

async function collectLines(
  input: AsyncIterable<Buffer | string>,
): Promise<string[]> {
  const lines = [];
  for await (const line of readRpcLines(input)) lines.push(line);
  return lines;
}

class CaptureWritable extends Writable {
  private readonly chunks: string[] = [];

  constructor() {
    super({ highWaterMark: 1 });
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString("utf8"));
    setTimeout(callback, 0);
  }

  text(): string {
    return this.chunks.join("");
  }
}
