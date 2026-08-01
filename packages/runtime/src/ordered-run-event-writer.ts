import type { RunEvent } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export type RunEventWrite = (event: RunEvent) => Promise<void>;

export class OrderedRunEventWriter {
  private readonly pending = new Map<number, RunEvent>();
  private readonly writtenSha256 = new Map<number, string>();
  private readonly firstSeq: number;
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
    this.firstSeq = firstSeq;
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

  reconcile(events: readonly RunEvent[]): Promise<void> {
    const task = this.drain.then(async () => {
      if (this.failure) throw this.failure;
      const seen = new Set<number>();
      const authoritative = new Map<number, RunEvent>();
      for (const event of events) {
        if (
          event.threadId !== this.threadId ||
          !Number.isSafeInteger(event.seq) ||
          event.seq < 1 ||
          seen.has(event.seq)
        ) {
          throw this.recordFailure(
            "Ordered event stream reconciliation is invalid",
          );
        }
        seen.add(event.seq);
        if (event.seq >= this.firstSeq) {
          authoritative.set(event.seq, event);
        }
      }
      const authoritativeSeqs = [...authoritative.keys()].sort(
        (left, right) => left - right,
      );
      if (
        authoritativeSeqs.some((seq, index) => seq !== this.firstSeq + index) ||
        [...this.writtenSha256.keys(), ...this.pending.keys()].some(
          (seq) => !authoritative.has(seq),
        )
      ) {
        throw this.recordFailure(
          "Ordered event stream reconciliation is incomplete",
        );
      }
      for (const seq of authoritativeSeqs) {
        const event = authoritative.get(seq)!;
        const eventSha256 = eventIdentity(event);
        const writtenSha256 = this.writtenSha256.get(seq);
        if (writtenSha256 !== undefined) {
          if (writtenSha256 !== eventSha256) {
            throw this.recordFailure(
              "Ordered event stream reconciliation conflicts with written evidence",
            );
          }
          continue;
        }
        const pending = this.pending.get(seq);
        if (pending) {
          if (eventIdentity(pending) !== eventSha256) {
            throw this.recordFailure(
              "Ordered event stream reconciliation conflicts with pending evidence",
            );
          }
          continue;
        }
        if (seq < this.nextSeq) {
          throw this.recordFailure(
            "Ordered event stream reconciliation is inconsistent",
          );
        }
        this.pending.set(seq, event);
      }
      await this.flushReady();
    });
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
      this.writtenSha256.set(event.seq, eventIdentity(event));
      this.nextSeq += 1;
    }
  }

  private reject(message: string): Promise<void> {
    return Promise.reject(this.recordFailure(message));
  }

  private recordFailure(message: string): Error {
    const error = new Error(message);
    this.failure ??= error;
    return error;
  }
}

function eventIdentity(event: RunEvent): string {
  return sha256(canonicalJson(event));
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
