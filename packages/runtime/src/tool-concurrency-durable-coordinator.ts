import { randomUUID } from "node:crypto";

import type {
  DurableToolConcurrencyLease,
  DurableToolConcurrencyLeaseToken,
  DurableToolConcurrencyRequirement,
  ToolConcurrencyLeaseBackend,
} from "./tool-concurrency-lease-backend.js";
import type { NormalizedToolConcurrencyRequirement } from "./tool-concurrency-model.js";

const DEFAULT_LEASE_TTL_MS = 120_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 25;

export interface ToolConcurrencyDurableCoordinatorOptions {
  readonly backend: ToolConcurrencyLeaseBackend;
  readonly ownerId: string;
  readonly leaseTtlMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly pollIntervalMs?: number;
  readonly now?: () => number;
}

export interface RunDurableToolConcurrencyOperationInput {
  readonly operationId: string;
  readonly requirements: readonly NormalizedToolConcurrencyRequirement[];
  readonly ancestorLeases: readonly DurableToolConcurrencyLeaseToken[];
  readonly signal?: AbortSignal;
}

/**
 * Coordinates the durable authority around the process-local fair queue.
 * The pre/post fences prevent a stale result from being accepted. They cannot
 * make an arbitrary external side effect atomic with SQLite; tools needing
 * exactly-once effects must additionally fence their domain-specific commit.
 */
export class ToolConcurrencyDurableCoordinator {
  private readonly backend: ToolConcurrencyLeaseBackend;
  private readonly ownerId: string;
  private readonly leaseTtlMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly pollIntervalMs: number;
  private readonly now: () => number;

  constructor(options: ToolConcurrencyDurableCoordinatorOptions) {
    this.backend = options.backend;
    this.ownerId = boundedText(options.ownerId, "owner ID", 3, 256);
    this.leaseTtlMs = boundedDuration(
      options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS,
      "lease TTL",
      20,
      30 * 60_000,
    );
    this.heartbeatIntervalMs = boundedDuration(
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      "heartbeat interval",
      5,
      this.leaseTtlMs - 1,
    );
    this.pollIntervalMs = boundedDuration(
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      "poll interval",
      1,
      5_000,
    );
    this.now = options.now ?? Date.now;
  }

  async run<T>(
    input: RunDurableToolConcurrencyOperationInput,
    operation: (lease: DurableToolConcurrencyLease) => Promise<T>,
  ): Promise<T> {
    const lease = await this.claim(input);
    const heartbeat = this.startHeartbeat(lease);
    let failed = false;
    try {
      await this.assertCurrent(lease);
      const result = await operation(lease);
      const heartbeatError = await heartbeat.stop();
      if (heartbeatError) throw heartbeatError.error;
      await this.assertCurrent(lease);
      return result;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      const heartbeatError = await heartbeat.stop();
      try {
        await this.backend.release({ lease, nowMs: this.timestamp() });
      } catch (releaseError) {
        if (!failed && !heartbeatError) throw releaseError;
      }
    }
  }

  private async claim(
    input: RunDurableToolConcurrencyOperationInput,
  ): Promise<DurableToolConcurrencyLease> {
    const leaseId = `toollease_${randomUUID().replaceAll("-", "")}`;
    const requirements = durableRequirements(input.requirements);
    while (true) {
      if (input.signal?.aborted) throw cancellationReason(input.signal);
      const nowMs = this.timestamp();
      const result = await this.backend.claim({
        leaseId,
        ownerId: this.ownerId,
        operationId: input.operationId,
        requirements,
        ancestorLeases: input.ancestorLeases,
        nowMs,
        expiresAtMs: nowMs + this.leaseTtlMs,
      });
      if (result.status === "acquired") return result.lease;
      const untilExpiry = Math.max(1, result.retryAtMs - nowMs);
      await wait(Math.min(this.pollIntervalMs, untilExpiry), input.signal);
    }
  }

  private startHeartbeat(lease: DurableToolConcurrencyLease): {
    stop(): Promise<{ readonly error: unknown } | undefined>;
  } {
    let stopped = false;
    let failure: { readonly error: unknown } | undefined;
    let pending = Promise.resolve();
    const timer = setInterval(() => {
      pending = pending.then(async () => {
        if (stopped || failure) return;
        try {
          const nowMs = this.timestamp();
          await this.backend.renew({
            lease,
            nowMs,
            expiresAtMs: nowMs + this.leaseTtlMs,
          });
        } catch (error) {
          failure = { error };
          clearInterval(timer);
        }
      });
    }, this.heartbeatIntervalMs);
    timer.unref?.();
    return {
      stop: async () => {
        if (!stopped) {
          stopped = true;
          clearInterval(timer);
        }
        await pending;
        return failure;
      },
    };
  }

  private assertCurrent(lease: DurableToolConcurrencyLease): Promise<unknown> {
    return Promise.resolve(
      this.backend.assertCurrent({ lease, nowMs: this.timestamp() }),
    );
  }

  private timestamp(): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Tool concurrency clock returned an invalid timestamp");
    }
    return value;
  }
}

function durableRequirements(
  requirements: readonly NormalizedToolConcurrencyRequirement[],
): DurableToolConcurrencyRequirement[] {
  return requirements.map((requirement) => ({
    key: [...requirement.key],
    mode: requirement.mode,
  }));
}

function boundedText(
  value: string,
  label: string,
  minimum: number,
  maximum: number,
): string {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new Error(`Tool concurrency ${label} is invalid`);
  }
  return normalized;
}

function boundedDuration(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Tool concurrency ${label} is invalid`);
  }
  return value;
}

function wait(durationMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancellationReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancellationReason(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function cancellationReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("Tool call was cancelled");
}
