import type { Writable } from "node:stream";

import { MAX_RPC_LINE_BYTES } from "./rpc-protocol.js";

export class RpcTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcTransportError";
  }
}

export async function* readRpcLines(
  input: AsyncIterable<Buffer | string>,
  maxLineBytes = MAX_RPC_LINE_BYTES,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1) {
    throw new Error("RPC line limit is invalid");
  }
  let pending = Buffer.alloc(0);
  const iterator = input[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await nextChunk(iterator, signal);
      if (next.done) break;
      const rawChunk = next.value;
      const chunk =
        typeof rawChunk === "string" ? Buffer.from(rawChunk, "utf8") : rawChunk;
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(0x0a, offset);
        const end = newline === -1 ? chunk.length : newline;
        const segment = chunk.subarray(offset, end);
        if (pending.length + segment.length > maxLineBytes) {
          throw new RpcTransportError("RPC input line exceeds the byte limit");
        }
        if (segment.length > 0) {
          pending = Buffer.concat([pending, segment]);
        }
        if (newline === -1) break;
        yield decodeLine(pending);
        pending = Buffer.alloc(0);
        offset = newline + 1;
      }
    }
  } finally {
    void iterator.return?.().catch(() => undefined);
  }
  if (pending.length > 0) yield decodeLine(pending);
}

export class RpcOutputWriter {
  private tail = Promise.resolve();
  private closed = false;
  private readonly handleOutputError = (error: unknown): void => {
    this.onFailure?.(error);
  };

  constructor(
    private readonly output: Writable,
    private readonly onFailure?: (error: unknown) => void,
  ) {
    output.on("error", this.handleOutputError);
  }

  write(value: unknown): Promise<void> {
    if (this.closed) return Promise.reject(new Error("RPC output is closed"));
    const line = `${JSON.stringify(value)}\n`;
    const pending = this.tail.then(() => writeChunk(this.output, line));
    this.tail = pending.catch((error: unknown) => {
      this.onFailure?.(error);
    });
    return pending;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.tail;
    this.output.removeListener("error", this.handleOutputError);
  }
}

function decodeLine(input: Buffer): string {
  const line =
    input.at(-1) === 0x0d ? input.subarray(0, input.length - 1) : input;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(line);
  } catch {
    throw new RpcTransportError("RPC input line is not valid UTF-8");
  }
}

async function writeChunk(output: Writable, value: string): Promise<void> {
  if (output.destroyed || output.writableEnded) {
    throw new Error("RPC output is unavailable");
  }
  await new Promise<void>((resolve, reject) => {
    output.write(value, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function nextChunk(
  iterator: AsyncIterator<Buffer | string>,
  signal?: AbortSignal,
): Promise<IteratorResult<Buffer | string>> {
  if (!signal) return iterator.next();
  signal.throwIfAborted();
  let abort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(new DOMException("RPC input aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([iterator.next(), aborted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
