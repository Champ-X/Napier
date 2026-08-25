import {
  type AutomationSchedule,
  type CreateAutomationScheduleRequest,
  type ScheduleClaim,
  type UpdateAutomationScheduleRequest,
} from "@napier/contracts";
import { nowIso } from "./ids.js";
import {
  assertRepositoryLeaseToken as assertLeaseToken,
  createRepositoryLeaseToken as createLeaseToken,
  validateRepositoryLeaseTtl as validateLeaseTtl,
} from "./repository-lease.js";
import { normalizeLeaseOwner } from "./run-lease-renewal.js";
import {
  advanceSchedule,
  createAutomationSchedule,
  updateAutomationSchedule,
} from "./schedules.js";
import { storeSha256 as sha256 } from "./store-hashing.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";

interface PersistedAutomationSchedule extends AutomationSchedule {
  claimTokenSha256?: string;
}

export interface SettleScheduleClaimInput {
  runId?: string;
  error?: string;
}

export interface DueScheduleClaims {
  claims: ScheduleClaim[];
  skipped: Array<{
    schedule: AutomationSchedule;
    scheduledFor: string;
    reason: string;
  }>;
}

function stripScheduleSecrets(
  schedule: PersistedAutomationSchedule,
): AutomationSchedule {
  const output = structuredClone(schedule);
  delete output.claimTokenSha256;
  return output;
}

export class AutomationScheduleRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  listSchedules(threadId?: string): AutomationSchedule[] {
    this.host.assertInitialized();
    return structuredClone(
      this.host.state.schedules
        .filter((schedule) => !threadId || schedule.threadId === threadId)
        .map(stripScheduleSecrets)
        .sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt)),
    );
  }

  getSchedule(scheduleId: string): AutomationSchedule {
    this.host.assertInitialized();
    const schedule = this.host.state.schedules.find(
      (candidate) => candidate.id === scheduleId,
    );
    if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`);
    return structuredClone(stripScheduleSecrets(schedule));
  }

  async createSchedule(
    request: CreateAutomationScheduleRequest,
  ): Promise<AutomationSchedule> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    const schedule = createAutomationSchedule(request);
    return this.host.stateQueue.run(async () => {
      this.host.state.schedules.push(schedule);
      await this.host.persistState();
      return structuredClone(stripScheduleSecrets(schedule));
    });
  }

  async updateSchedule(
    scheduleId: string,
    request: UpdateAutomationScheduleRequest,
  ): Promise<AutomationSchedule> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const schedule = this.host.mutableSchedule(scheduleId);
      const updated: PersistedAutomationSchedule = {
        ...updateAutomationSchedule(schedule, request),
        ...(schedule.claimTokenSha256
          ? { claimTokenSha256: schedule.claimTokenSha256 }
          : {}),
      };
      const index = this.host.state.schedules.findIndex(
        (candidate) => candidate.id === scheduleId,
      );
      this.host.state.schedules[index] = updated;
      if (updated.revision !== schedule.revision)
        await this.host.persistState();
      return structuredClone(stripScheduleSecrets(updated));
    });
  }

  async claimDueSchedules(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<DueScheduleClaims> {
    this.host.assertInitialized();
    const owner = normalizeLeaseOwner(ownerId);
    const now = options.now ?? new Date();
    if (!Number.isFinite(now.getTime()))
      throw new Error("Claim time is invalid");
    const leaseMs = validateLeaseTtl(options.leaseMs ?? 60_000);
    const limit = Math.min(Math.max(options.limit ?? 10, 1), 100);
    return this.host.stateQueue.run(async () => {
      const claims: ScheduleClaim[] = [];
      const skipped: DueScheduleClaims["skipped"] = [];
      const due = this.host.state.schedules
        .filter(
          (schedule) =>
            schedule.status === "active" &&
            Date.parse(schedule.nextRunAt) <= now.getTime(),
        )
        .sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt));
      let processed = 0;
      for (const schedule of due) {
        if (processed >= limit) break;
        if (
          schedule.claim &&
          Date.parse(schedule.claim.expiresAt) > now.getTime()
        ) {
          continue;
        }
        processed += 1;
        const scheduledFor = schedule.nextRunAt;
        const thread = this.host.mutableThread(schedule.threadId);
        if (thread.currentRunId) {
          const reason = `Skipped because thread has active run ${thread.currentRunId}`;
          schedule.lastScheduledFor = scheduledFor;
          schedule.lastError = reason;
          schedule.nextRunAt = advanceSchedule(schedule, scheduledFor, now);
          schedule.updatedAt = now.toISOString();
          schedule.revision += 1;
          delete schedule.claim;
          delete schedule.claimTokenSha256;
          skipped.push({
            schedule: structuredClone(stripScheduleSecrets(schedule)),
            scheduledFor,
            reason,
          });
          continue;
        }
        const token = createLeaseToken();
        schedule.claim = {
          ownerId: owner,
          scheduledFor,
          acquiredAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
          revision: (schedule.claim?.revision ?? 0) + 1,
        };
        schedule.claimTokenSha256 = sha256(token);
        schedule.updatedAt = now.toISOString();
        schedule.revision += 1;
        claims.push({
          schedule: structuredClone(stripScheduleSecrets(schedule)),
          token,
          scheduledFor,
        });
      }
      if (claims.length > 0 || skipped.length > 0)
        await this.host.persistState();
      return { claims, skipped };
    });
  }

  async renewScheduleClaim(
    scheduleId: string,
    token: string,
    ttlMs: number,
  ): Promise<AutomationSchedule> {
    this.host.assertInitialized();
    const normalizedTtl = validateLeaseTtl(ttlMs);
    return this.host.stateQueue.run(async () => {
      const schedule = this.host.mutableSchedule(scheduleId);
      assertLeaseToken(schedule.claimTokenSha256, token);
      if (!schedule.claim) throw new Error("Schedule claim is not active");
      const heartbeatAt = nowIso();
      schedule.claim = {
        ...schedule.claim,
        expiresAt: new Date(
          Date.parse(heartbeatAt) + normalizedTtl,
        ).toISOString(),
        revision: schedule.claim.revision + 1,
      };
      schedule.updatedAt = heartbeatAt;
      await this.host.persistState();
      return structuredClone(stripScheduleSecrets(schedule));
    });
  }

  async settleScheduleClaim(
    scheduleId: string,
    token: string,
    input: SettleScheduleClaimInput,
  ): Promise<AutomationSchedule> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const schedule = this.host.mutableSchedule(scheduleId);
      assertLeaseToken(schedule.claimTokenSha256, token);
      const claim = schedule.claim;
      if (!claim) throw new Error("Schedule claim is not active");
      if (input.runId) {
        const run = this.host.state.runs.find(
          (candidate) =>
            candidate.id === input.runId &&
            candidate.threadId === schedule.threadId,
        );
        if (!run) throw new Error("Schedule run does not belong to its thread");
        schedule.lastRunId = input.runId;
        schedule.lastRunAt = nowIso();
      }
      schedule.lastScheduledFor = claim.scheduledFor;
      if (input.error) schedule.lastError = input.error.slice(0, 500);
      else delete schedule.lastError;
      schedule.nextRunAt = advanceSchedule(
        schedule,
        claim.scheduledFor,
        new Date(),
      );
      delete schedule.claim;
      delete schedule.claimTokenSha256;
      schedule.updatedAt = nowIso();
      schedule.revision += 1;
      await this.host.persistState();
      return structuredClone(stripScheduleSecrets(schedule));
    });
  }
}
