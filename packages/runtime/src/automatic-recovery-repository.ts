import {
  type AutomaticRecoveryAssessment,
  type AutomaticRecoveryAttempt,
  type AutomaticRecoveryClaim,
} from "@napier/contracts";
import { claimAutomaticRecoveryState } from "./automatic-recovery-store-claims.js";
import {
  abandonAutomaticRecoveryState,
  bindAutomaticRecoveryRunState,
  renewAutomaticRecoveryState,
  settleAutomaticRecoveryState,
} from "./automatic-recovery-store-mutations.js";
import { stripAutomaticRecoverySecrets } from "./automatic-recovery-store-records.js";
import { normalizeLeaseOwner } from "./run-lease-renewal.js";
import {
  assertRepositoryLeaseToken as assertLeaseToken,
  createRepositoryLeaseToken as createLeaseToken,
  validateRepositoryLeaseTtl as validateLeaseTtl,
} from "./repository-lease.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";

export interface AutomaticRecoveryClaims {
  claims: AutomaticRecoveryClaim[];
  skipped: AutomaticRecoveryAssessment[];
  settled: AutomaticRecoveryAttempt[];
  deferred: number;
}

function boundedStoreInteger(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return value;
}

export class AutomaticRecoveryRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  listAutomaticRecoveryAssessments(
    threadId?: string,
  ): AutomaticRecoveryAssessment[] {
    this.host.assertInitialized();
    return structuredClone(
      this.host.state.automaticRecoveryAssessments
        .filter((assessment) => !threadId || assessment.threadId === threadId)
        .sort((left, right) => left.assessedAt.localeCompare(right.assessedAt)),
    );
  }

  listAutomaticRecoveryAttempts(threadId?: string): AutomaticRecoveryAttempt[] {
    this.host.assertInitialized();
    return structuredClone(
      this.host.state.automaticRecoveryAttempts
        .filter((attempt) => !threadId || attempt.threadId === threadId)
        .map(stripAutomaticRecoverySecrets)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  getAutomaticRecoveryAttempt(attemptId: string): AutomaticRecoveryAttempt {
    this.host.assertInitialized();
    const attempt = this.host.state.automaticRecoveryAttempts.find(
      (candidate) => candidate.id === attemptId,
    );
    if (!attempt) {
      throw new Error(`Automatic recovery attempt not found: ${attemptId}`);
    }
    return structuredClone(stripAutomaticRecoverySecrets(attempt));
  }

  async claimAutomaticRecoveries(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<AutomaticRecoveryClaims> {
    this.host.assertInitialized();
    const owner = normalizeLeaseOwner(ownerId);
    const leaseMs = validateLeaseTtl(options.leaseMs ?? 60_000);
    const now = options.now ?? new Date();
    if (!Number.isFinite(now.getTime())) {
      throw new Error("Automatic recovery claim time is invalid");
    }
    const limit =
      options.limit === undefined
        ? 8
        : boundedStoreInteger(
            options.limit,
            "Automatic recovery claim limit",
            1,
            32,
          );
    return this.host.stateQueue.run(async () => {
      const { changed, ...claims } = claimAutomaticRecoveryState({
        state: this.host.state,
        ownerId: owner,
        leaseMs,
        limit,
        now,
        createToken: createLeaseToken,
        listEvents: (threadId) =>
          this.host.requireLedger().listEvents(threadId),
      });
      if (changed) await this.host.persistState();
      return claims;
    });
  }

  async renewAutomaticRecoveryClaim(
    attemptId: string,
    token: string,
    ttlMs: number,
  ): Promise<AutomaticRecoveryAttempt> {
    this.host.assertInitialized();
    const normalizedTtl = validateLeaseTtl(ttlMs);
    return this.host.stateQueue.run(async () => {
      const attempt = renewAutomaticRecoveryState({
        state: this.host.state,
        attemptId,
        token,
        ttlMs: normalizedTtl,
        now: () => new Date(),
        assertToken: assertLeaseToken,
      });
      await this.host.persistState();
      return attempt;
    });
  }

  async bindAutomaticRecoveryRun(
    attemptId: string,
    token: string,
    recoveryRunId: string,
  ): Promise<AutomaticRecoveryAttempt> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const attempt = bindAutomaticRecoveryRunState({
        state: this.host.state,
        attemptId,
        token,
        recoveryRunId,
        now: () => new Date(),
        assertToken: assertLeaseToken,
      });
      await this.host.persistState();
      return attempt;
    });
  }

  async settleAutomaticRecoveryAttempt(
    attemptId: string,
    token: string,
    recoveryRunId: string,
  ): Promise<AutomaticRecoveryAttempt> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const attempt = settleAutomaticRecoveryState({
        state: this.host.state,
        attemptId,
        token,
        recoveryRunId,
        now: () => new Date(),
        assertToken: assertLeaseToken,
      });
      await this.host.persistState();
      return attempt;
    });
  }

  async abandonAutomaticRecoveryAttempt(
    attemptId: string,
    token: string,
    error: string,
  ): Promise<AutomaticRecoveryAttempt> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const attempt = abandonAutomaticRecoveryState({
        state: this.host.state,
        attemptId,
        token,
        error,
        now: () => new Date(),
        assertToken: assertLeaseToken,
      });
      await this.host.persistState();
      return attempt;
    });
  }
}
