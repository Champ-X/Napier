import type { JsonObject, RunEvent } from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import { sha256 } from "./ed25519.js";
import { RunEventAdmissionError } from "./run-event-admission.js";
import type { AppendEventInput } from "./store.js";

export type ModelDeltaEventType = "model.text.delta" | "model.thinking.delta";

type PendingDelta = {
  type: ModelDeltaEventType;
  redacted: boolean;
  chunks: string[];
  chunkCount: number;
  bytes: number;
  startedAt: number;
};

type DeltaPolicy = {
  maxDelayMs: number;
  maxBytes: number;
};

const TEXT_POLICY: DeltaPolicy = { maxDelayMs: 100, maxBytes: 1_024 };
const THINKING_POLICY: DeltaPolicy = {
  maxDelayMs: 5_000,
  maxBytes: 4_096,
};

export class ModelDeltaBatcher {
  private pending: PendingDelta | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly threadId: string,
    private readonly runId: string,
    private readonly record: (
      input: AppendEventInput,
      onEvent?: EventSink,
    ) => Promise<RunEvent>,
    private readonly onEvent?: EventSink,
    private readonly now: () => number = Date.now,
  ) {}

  async push(
    type: ModelDeltaEventType,
    delta: string,
    redacted: boolean,
  ): Promise<void> {
    await this.inFlight;
    if (!delta) return;
    if (
      this.pending &&
      (this.pending.type !== type || this.pending.redacted !== redacted)
    ) {
      await this.flush();
    }
    this.pending ??= {
      type,
      redacted,
      chunks: [],
      chunkCount: 0,
      bytes: 0,
      startedAt: this.now(),
    };
    this.pending.chunks.push(delta);
    this.pending.chunkCount += 1;
    this.pending.bytes += Buffer.byteLength(delta, "utf8");
    const policy = policyFor(type);
    if (
      this.pending.bytes >= policy.maxBytes ||
      this.now() - this.pending.startedAt >= policy.maxDelayMs
    ) {
      await this.flush();
    } else {
      this.armTimer(policy.maxDelayMs);
    }
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.inFlight;
    await this.flushPending();
  }

  private armTimer(delayMs: number): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.inFlight = this.inFlight.then(() => this.flushPending());
    }, delayMs);
    this.timer.unref?.();
  }

  private async flushPending(): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    const delta = pending.chunks.join("");
    try {
      await this.record(
        {
          threadId: this.threadId,
          runId: this.runId,
          type: pending.type,
          category: "model",
          visibility: "hidden",
          payload: deltaPayload(pending, delta),
          admission: "run_active",
        },
        pending.redacted ? undefined : this.onEvent,
      );
    } catch (error) {
      if (error instanceof RunEventAdmissionError) return;
      this.pending = pending;
      throw error;
    }
  }
}

function policyFor(type: ModelDeltaEventType): DeltaPolicy {
  return type === "model.thinking.delta" ? THINKING_POLICY : TEXT_POLICY;
}

function deltaPayload(pending: PendingDelta, delta: string): JsonObject {
  const shared = {
    chunkCount: pending.chunkCount,
    deltaBytes: pending.bytes,
  };
  return pending.redacted
    ? {
        ...shared,
        deltaSha256: sha256(delta),
        redacted: true,
      }
    : { ...shared, delta };
}
