import type { AutomationSchedule, ScheduleClaim } from "@napier/contracts";

import type { AgentExecutionPort } from "./agent-execution.js";
import { createId } from "./ids.js";
import { LocalStore } from "./store.js";

const DEFAULT_TICK_MS = 5_000;
const DEFAULT_CLAIM_TTL_MS = 60_000;
const CLAIM_HEARTBEAT_MS = 20_000;

export interface AutomationServiceOptions {
  tickMs?: number;
  claimTtlMs?: number;
  workerId?: string;
}

export interface AutomationTickResult {
  claimed: number;
  skipped: number;
  completed: number;
  failed: number;
  deduplicated: number;
}

export class AutomationService {
  private readonly workerId: string;
  private readonly tickMs: number;
  private readonly claimTtlMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking: Promise<AutomationTickResult> | undefined;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    readonly store: LocalStore,
    readonly runtime: Pick<AgentExecutionPort, "modelRegistry" | "runPrompt">,
    options: AutomationServiceOptions = {},
  ) {
    this.workerId = options.workerId ?? createId("scheduler");
    this.tickMs = boundedDuration(
      options.tickMs ?? DEFAULT_TICK_MS,
      "Automation tick",
      250,
      60_000,
    );
    this.claimTtlMs = boundedDuration(
      options.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS,
      "Schedule claim TTL",
      5_000,
      10 * 60_000,
    );
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.ticking) await this.ticking;
    await Promise.allSettled([...this.inFlight]);
  }

  tick(now = new Date()): Promise<AutomationTickResult> {
    if (this.ticking) return this.ticking;
    const operation = this.runTick(now).finally(() => {
      this.ticking = undefined;
    });
    this.ticking = operation;
    return operation;
  }

  private async runTick(now: Date): Promise<AutomationTickResult> {
    const due = await this.store.claimDueSchedules(this.workerId, {
      now,
      leaseMs: this.claimTtlMs,
    });
    const result: AutomationTickResult = {
      claimed: due.claims.length,
      skipped: due.skipped.length,
      completed: 0,
      failed: 0,
      deduplicated: 0,
    };
    for (const skipped of due.skipped) {
      await this.recordScheduleEvent(skipped.schedule, "schedule.skipped", {
        scheduledFor: skipped.scheduledFor,
        reason: skipped.reason,
      });
    }
    await Promise.all(
      due.claims.map(async (claim) => {
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
    claim: ScheduleClaim,
    result: AutomationTickResult,
  ): Promise<void> {
    const triggerId = scheduleTriggerId(claim.schedule.id, claim.scheduledFor);
    await this.recordScheduleEvent(claim.schedule, "schedule.claimed", {
      scheduledFor: claim.scheduledFor,
      triggerId,
      workerId: this.workerId,
    });
    const existing = this.store.getRunByTriggerId(triggerId);
    if (existing) {
      await this.store.settleScheduleClaim(claim.schedule.id, claim.token, {
        runId: existing.id,
        ...(existing.status === "completed"
          ? {}
          : { error: `Existing trigger run is ${existing.status}` }),
      });
      await this.recordScheduleEvent(
        claim.schedule,
        "schedule.deduplicated",
        {
          scheduledFor: claim.scheduledFor,
          triggerId,
          runId: existing.id,
          runStatus: existing.status,
        },
        existing.id,
      );
      result.deduplicated += 1;
      return;
    }

    const heartbeat = setInterval(
      () => {
        void this.store
          .renewScheduleClaim(claim.schedule.id, claim.token, this.claimTtlMs)
          .catch(() => undefined);
      },
      Math.min(CLAIM_HEARTBEAT_MS, Math.floor(this.claimTtlMs / 2)),
    );
    heartbeat.unref?.();
    try {
      await this.assertScheduleModelAvailable(claim.schedule);
      const run = await this.runtime.runPrompt({
        threadId: claim.schedule.threadId,
        text: claim.schedule.prompt,
        source: "schedule",
        triggerId,
        ...(claim.schedule.model ? { model: claim.schedule.model } : {}),
      });
      await this.store.settleScheduleClaim(claim.schedule.id, claim.token, {
        runId: run.id,
        ...(run.status === "completed"
          ? {}
          : { error: `Scheduled run settled as ${run.status}` }),
      });
      await this.recordScheduleEvent(
        claim.schedule,
        run.status === "completed" ? "schedule.completed" : "schedule.failed",
        {
          scheduledFor: claim.scheduledFor,
          triggerId,
          runId: run.id,
          runStatus: run.status,
        },
        run.id,
      );
      if (run.status === "completed") result.completed += 1;
      else result.failed += 1;
    } catch (error) {
      const message = safeError(error);
      const duplicate = this.store.getRunByTriggerId(triggerId);
      await this.store.settleScheduleClaim(claim.schedule.id, claim.token, {
        ...(duplicate ? { runId: duplicate.id } : {}),
        error: message,
      });
      await this.recordScheduleEvent(
        claim.schedule,
        duplicate ? "schedule.deduplicated" : "schedule.failed",
        {
          scheduledFor: claim.scheduledFor,
          triggerId,
          ...(duplicate ? { runId: duplicate.id } : {}),
          error: message,
        },
        duplicate?.id,
      );
      if (duplicate) result.deduplicated += 1;
      else result.failed += 1;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async recordScheduleEvent(
    schedule: AutomationSchedule,
    type: string,
    payload: Record<string, string>,
    runId?: string,
  ): Promise<void> {
    await this.store.appendEvent({
      threadId: schedule.threadId,
      runId: runId ?? createId("runctl"),
      type,
      category: "automation",
      visibility: "user",
      payload: {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        ...payload,
      },
    });
  }

  private async assertScheduleModelAvailable(
    schedule: AutomationSchedule,
  ): Promise<void> {
    const thread = this.store.getThread(schedule.threadId);
    const agent = this.store.getAgent(thread.agentId);
    const model = schedule.model ?? agent.model;
    await this.runtime.modelRegistry.resolveConfigured(model);
  }
}

export function scheduleTriggerId(
  scheduleId: string,
  scheduledFor: string,
): string {
  return `schedule:${scheduleId}:${new Date(scheduledFor).toISOString()}`;
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
    .slice(0, 500);
}
