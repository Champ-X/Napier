import type {
  AutomaticRecoveryAssessment,
  AutomaticRecoveryAttempt,
  AutomaticRecoveryClaim,
  JsonValue,
} from "@napier/contracts";

import { AgentRuntime } from "./agent-runtime.js";
import { createId } from "./ids.js";
import { LocalStore } from "./store.js";

const DEFAULT_SWEEP_MS = 2_000;
const DEFAULT_CLAIM_TTL_MS = 60_000;
const CLAIM_HEARTBEAT_MS = 20_000;

export interface RecoveryServiceOptions {
  sweepMs?: number;
  claimTtlMs?: number;
  workerId?: string;
}

export interface RecoverySweepResult {
  claimed: number;
  skipped: number;
  settled: number;
  deferred: number;
  completed: number;
  failed: number;
  deduplicated: number;
}

export class RecoveryService {
  private readonly workerId: string;
  private readonly sweepMs: number;
  private readonly claimTtlMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private sweeping: Promise<RecoverySweepResult> | undefined;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    readonly store: LocalStore,
    readonly runtime: AgentRuntime,
    options: RecoveryServiceOptions = {},
  ) {
    this.workerId = options.workerId ?? createId("recoveryworker");
    this.sweepMs = boundedDuration(
      options.sweepMs ?? DEFAULT_SWEEP_MS,
      "Recovery sweep",
      250,
      60_000,
    );
    this.claimTtlMs = boundedDuration(
      options.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS,
      "Recovery claim TTL",
      5_000,
      10 * 60_000,
    );
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.sweep().catch(() => undefined);
    }, this.sweepMs);
    this.timer.unref?.();
    void this.sweep().catch(() => undefined);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.sweeping) await this.sweeping;
    await Promise.allSettled([...this.inFlight]);
  }

  sweep(now = new Date()): Promise<RecoverySweepResult> {
    if (this.sweeping) return this.sweeping;
    const operation = this.runSweep(now).finally(() => {
      this.sweeping = undefined;
    });
    this.sweeping = operation;
    return operation;
  }

  private async runSweep(now: Date): Promise<RecoverySweepResult> {
    await this.reconcileEvidence();
    const claimed = await this.store.claimAutomaticRecoveries(this.workerId, {
      now,
      leaseMs: this.claimTtlMs,
    });
    const result: RecoverySweepResult = {
      claimed: claimed.claims.length,
      skipped: claimed.skipped.length,
      settled: claimed.settled.length,
      deferred: claimed.deferred,
      completed: 0,
      failed: 0,
      deduplicated: 0,
    };
    for (const assessment of claimed.skipped) {
      await this.ensureAssessmentEvidence(assessment);
    }
    for (const attempt of claimed.settled) {
      await this.ensureAttemptEvidence(attempt);
    }
    await Promise.all(
      claimed.claims.map(async (claim) => {
        const task = this.executeClaim(claim, result);
        this.inFlight.add(task);
        try {
          await task;
        } finally {
          this.inFlight.delete(task);
        }
      }),
    );
    return result;
  }

  private async executeClaim(
    claim: AutomaticRecoveryClaim,
    result: RecoverySweepResult,
  ): Promise<void> {
    await this.ensureAttemptEvidence(claim.attempt);
    const existing = this.store.getRunByTriggerId(claim.attempt.triggerId);
    if (existing) {
      const settled = await this.bindOrSettleExisting(claim, existing.id);
      await this.ensureAttemptEvidence(settled);
      result.deduplicated += 1;
      return;
    }
    const heartbeat = setInterval(
      () => {
        void this.store
          .renewAutomaticRecoveryClaim(
            claim.attempt.id,
            claim.token,
            this.claimTtlMs,
          )
          .catch(() => undefined);
      },
      Math.min(CLAIM_HEARTBEAT_MS, Math.floor(this.claimTtlMs / 2)),
    );
    heartbeat.unref?.();
    try {
      const run = await this.runtime.resumeInterruptedRunAutomatically({
        assessment: claim.assessment,
        attempt: claim.attempt,
        onRunCreated: async (created) => {
          const attempt = await this.store.bindAutomaticRecoveryRun(
            claim.attempt.id,
            claim.token,
            created.id,
          );
          await this.ensureAttemptEvidence(attempt);
        },
      });
      const attempt = await this.store.settleAutomaticRecoveryAttempt(
        claim.attempt.id,
        claim.token,
        run.id,
      );
      await this.ensureAttemptEvidence(attempt);
      if (attempt.status === "completed") result.completed += 1;
      else result.failed += 1;
    } catch (error) {
      const duplicate = this.store.getRunByTriggerId(claim.attempt.triggerId);
      if (duplicate) {
        try {
          const attempt = await this.bindOrSettleExisting(claim, duplicate.id);
          await this.ensureAttemptEvidence(attempt);
          result.deduplicated += 1;
          return;
        } catch {
          // Preserve the original execution error below.
        }
      }
      try {
        const attempt = await this.store.abandonAutomaticRecoveryAttempt(
          claim.attempt.id,
          claim.token,
          safeError(error),
        );
        await this.ensureAttemptEvidence(attempt);
      } catch (abandonError) {
        const rebound = this.store.getRunByTriggerId(claim.attempt.triggerId);
        if (rebound) {
          // A bound Run is reconciled from its durable trigger on the next sweep.
          result.failed += 1;
          return;
        }
        throw abandonError;
      }
      result.failed += 1;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async bindOrSettleExisting(
    claim: AutomaticRecoveryClaim,
    runId: string,
  ): Promise<AutomaticRecoveryAttempt> {
    const run = this.store.getRunByTriggerId(claim.attempt.triggerId);
    if (!run || run.id !== runId) {
      throw new Error("Automatic recovery trigger Run disappeared");
    }
    if (run.status === "queued" || run.status === "running") {
      return this.store.bindAutomaticRecoveryRun(
        claim.attempt.id,
        claim.token,
        run.id,
      );
    }
    return this.store.settleAutomaticRecoveryAttempt(
      claim.attempt.id,
      claim.token,
      run.id,
    );
  }

  private async reconcileEvidence(): Promise<void> {
    for (const assessment of this.store.listAutomaticRecoveryAssessments()) {
      if (!assessment.eligible) {
        await this.ensureAssessmentEvidence(assessment);
      }
    }
    for (const attempt of this.store.listAutomaticRecoveryAttempts()) {
      await this.ensureAttemptEvidence(attempt);
    }
  }

  private async ensureAssessmentEvidence(
    assessment: AutomaticRecoveryAssessment,
  ): Promise<void> {
    const events = await this.store.listEvents(assessment.threadId);
    if (
      events.some(
        (event) =>
          event.type === "run.recovery.auto.skipped" &&
          isPayloadMatch(
            event.payload,
            "assessmentSha256",
            assessment.contentSha256,
          ),
      )
    ) {
      return;
    }
    await this.record(assessment.threadId, "run.recovery.auto.skipped", {
      sourceRunId: assessment.runId,
      rootRunId: assessment.rootRunId,
      assessmentSha256: assessment.contentSha256,
      blockReasons: assessment.blockReasons,
      priorAttempts: assessment.priorAttempts,
      toolCalls: assessment.toolCalls,
      eventStreamSha256: assessment.eventRange.eventStreamSha256,
    });
  }

  private async ensureAttemptEvidence(
    attempt: AutomaticRecoveryAttempt,
  ): Promise<void> {
    const eventType = attemptEventType(attempt.status);
    const events = await this.store.listEvents(attempt.threadId);
    if (
      events.some(
        (event) =>
          event.type === eventType &&
          isPayloadMatch(event.payload, "attemptId", attempt.id),
      )
    ) {
      return;
    }
    await this.record(attempt.threadId, eventType, {
      attemptId: attempt.id,
      revision: attempt.revision,
      sourceRunId: attempt.interruptedRunId,
      rootRunId: attempt.rootRunId,
      attempt: attempt.attempt,
      maxAttempts: attempt.maxAttempts,
      assessmentSha256: attempt.assessmentSha256,
      status: attempt.status,
      ...(attempt.recoveryRunId
        ? { recoveryRunId: attempt.recoveryRunId }
        : {}),
      ...(attempt.error ? { error: safeError(attempt.error) } : {}),
    });
  }

  private async record(
    threadId: string,
    type: string,
    payload: Record<string, JsonValue>,
  ): Promise<void> {
    await this.store.appendEvent({
      threadId,
      runId: createId("runctl"),
      type,
      category: "automation",
      visibility: "user",
      payload,
    });
  }
}

function attemptEventType(status: AutomaticRecoveryAttempt["status"]): string {
  if (status === "claimed") return "run.recovery.auto.claimed";
  if (status === "running") return "run.recovery.auto.started";
  if (status === "completed") return "run.recovery.auto.completed";
  if (status === "interrupted") return "run.recovery.auto.interrupted";
  if (status === "abandoned") return "run.recovery.auto.abandoned";
  return "run.recovery.auto.failed";
}

function isPayloadMatch(
  payload: JsonValue,
  key: string,
  value: string | number,
): boolean {
  return Boolean(
    payload &&
    !Array.isArray(payload) &&
    typeof payload === "object" &&
    payload[key] === value,
  );
}

function boundedDuration(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be from ${minimum} to ${maximum} ms`);
  }
  return value;
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
}
