import type { RunEvent } from "@napier/contracts";

export type RunEventWrite = (event: RunEvent) => Promise<void>;

export class OrderedRunEventWriter {
  private readonly pending = new Map<number, RunEvent>();
  private nextSeq: number;
  private drain: Promise<void> = Promise.resolve();
  private failure: Error | undefined;

  constructor(
    private readonly threadId: string,
    firstSeq: number,
    private readonly writeEvent: RunEventWrite,
  ) {
    if (!Number.isSafeInteger(firstSeq) || firstSeq < 1) {
      throw new Error("Ordered event stream first sequence is invalid");
    }
    this.nextSeq = firstSeq;
  }

  write(event: RunEvent): Promise<void> {
    if (
      event.threadId !== this.threadId ||
      !Number.isSafeInteger(event.seq) ||
      event.seq < this.nextSeq ||
      this.pending.has(event.seq)
    ) {
      return this.reject("Ordered event stream received invalid sequence");
    }
    this.pending.set(event.seq, event);
    const task = this.drain.then(() => this.flushReady());
    this.drain = task.catch((error: unknown) => {
      this.failure ??= asError(error);
    });
    return task;
  }

  async finish(lastSeq: number): Promise<void> {
    await this.drain;
    if (this.failure) throw this.failure;
    await this.flushReady();
    if (
      !Number.isSafeInteger(lastSeq) ||
      lastSeq < this.nextSeq - 1 ||
      this.pending.size > 0 ||
      this.nextSeq !== lastSeq + 1
    ) {
      throw new Error("Ordered event stream is incomplete");
    }
  }

  private async flushReady(): Promise<void> {
    if (this.failure) throw this.failure;
    for (;;) {
      const event = this.pending.get(this.nextSeq);
      if (!event) return;
      this.pending.delete(this.nextSeq);
      await this.writeEvent(event);
      this.nextSeq += 1;
    }
  }

  private reject(message: string): Promise<void> {
    const error = new Error(message);
    this.failure ??= error;
    return Promise.reject(error);
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
