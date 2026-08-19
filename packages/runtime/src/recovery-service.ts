import type {
  AutomaticRecoveryAssessment,
  AutomaticRecoveryAttempt,
  AutomaticRecoveryClaim,
  JsonValue,
  RunEvent,
} from "@napier/contracts";

import type { AgentExecutionPort } from "./agent-execution.js";
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
  private readonly evidenceIndexes = new Map<string, Promise<Set<string>>>();

  constructor(
    readonly store: LocalStore,
    readonly runtime: Pick<
      AgentExecutionPort,
      "resumeInterruptedRunAutomatically"
    >,
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
    const evidence = await this.evidenceIndex(assessment.threadId);
    const key = assessmentEvidenceKey(assessment.contentSha256);
    if (evidence.has(key)) return;
    await this.record(assessment.threadId, "run.recovery.auto.skipped", {
      sourceRunId: assessment.runId,
      rootRunId: assessment.rootRunId,
      assessmentSha256: assessment.contentSha256,
      blockReasons: assessment.blockReasons,
      priorAttempts: assessment.priorAttempts,
      toolCalls: assessment.toolCalls,
      eventStreamSha256: assessment.eventRange.eventStreamSha256,
    });
    evidence.add(key);
  }

  private async ensureAttemptEvidence(
    attempt: AutomaticRecoveryAttempt,
  ): Promise<void> {
    const eventType = attemptEventType(attempt.status);
    const evidence = await this.evidenceIndex(attempt.threadId);
    const key = attemptEvidenceKey(eventType, attempt.id);
    if (evidence.has(key)) return;
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
    evidence.add(key);
  }

  private evidenceIndex(threadId: string): Promise<Set<string>> {
    const cached = this.evidenceIndexes.get(threadId);
    if (cached) return cached;
    const loading = this.store
      .listEvents(threadId)
      .then((events) => recoveryEvidenceIndex(events))
      .catch((error: unknown) => {
        this.evidenceIndexes.delete(threadId);
        throw error;
      });
    this.evidenceIndexes.set(threadId, loading);
    return loading;
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

function recoveryEvidenceIndex(events: RunEvent[]): Set<string> {
  const evidence = new Set<string>();
  for (const event of events) {
    const assessmentSha256 = payloadString(event.payload, "assessmentSha256");
    if (event.type === "run.recovery.auto.skipped" && assessmentSha256) {
      evidence.add(assessmentEvidenceKey(assessmentSha256));
    }
    const attemptId = payloadString(event.payload, "attemptId");
    if (event.type.startsWith("run.recovery.auto.") && attemptId) {
      evidence.add(attemptEvidenceKey(event.type, attemptId));
    }
  }
  return evidence;
}

function assessmentEvidenceKey(contentSha256: string): string {
  return `assessment:${contentSha256}`;
}

function attemptEvidenceKey(eventType: string, attemptId: string): string {
  return `attempt:${eventType}:${attemptId}`;
}

function payloadString(payload: JsonValue, key: string): string | undefined {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return undefined;
  }
  return typeof payload[key] === "string" ? payload[key] : undefined;
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
