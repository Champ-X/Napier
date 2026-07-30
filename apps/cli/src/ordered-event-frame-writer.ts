import { once } from "node:events";
import type { Writable } from "node:stream";

import type { RunEvent } from "@napier/contracts";
import { OrderedRunEventWriter, streamEventFrame } from "@napier/runtime";

export class OrderedEventFrameWriter {
  private readonly writer: OrderedRunEventWriter;

  constructor(
    private readonly stream: Writable,
    threadId: string,
    firstSeq: number,
  ) {
    this.writer = new OrderedRunEventWriter(threadId, firstSeq, async (event) =>
      writeJsonLine(this.stream, streamEventFrame(event)),
    );
  }

  write(event: RunEvent): Promise<void> {
    return this.writer.write(event).catch(rethrowJsonlStreamError);
  }

  finish(lastSeq: number): Promise<void> {
    return this.writer.finish(lastSeq).catch(rethrowJsonlStreamError);
  }
}

async function writeJsonLine(stream: Writable, value: unknown): Promise<void> {
  if (stream.write(`${JSON.stringify(value)}\n`)) return;
  await once(stream, "drain");
}

function rethrowJsonlStreamError(error: unknown): never {
  if (
    error instanceof Error &&
    error.message.startsWith("Ordered event stream ")
  ) {
    throw new Error(error.message.replace(/^Ordered/u, "JSONL"), {
      cause: error,
    });
  }
  throw error;
}
