import {
  emptyUsage,
  type RunLimits,
  type SubagentTask,
  type Usage,
  type UsageAccounting,
} from "@napier/contracts";

import {
  totalRawTokens,
  usageBudgetCostUsd,
  usageBudgetTokens,
} from "./token-accounting.js";

export type RunBudgetReason = "turns" | "tokens" | "cost" | "timeout";

export interface RunBudgetObserved {
  turns: number;
  totalTokens: number;
  rawTotalTokens: number;
  costUsd: number;
  rawCostUsd: number;
  elapsedMs: number;
  usage: Usage;
}

export interface RunBudgetExhaustion {
  reason: RunBudgetReason;
  limit: number;
  observed: RunBudgetObserved;
  message: string;
}

export class RunBudgetExceededError extends Error {
  constructor(readonly exhaustion: RunBudgetExhaustion) {
    super(exhaustion.message);
    this.name = "RunBudgetExceededError";
  }
}

export class RunBudgetTracker {
  readonly limits: RunLimits;
  private readonly startedAtMs: number;
  private readonly subagentUsage = new Map<string, Usage>();
  private usage = emptyUsage();
  private budgetTokens = 0;
  private budgetCostUsd = 0;
  private primaryTurns = 0;
  private exhausted?: RunBudgetExhaustion;

  constructor(limits: RunLimits, startedAt: string | number = Date.now()) {
    this.limits = structuredClone(limits);
    this.startedAtMs =
      typeof startedAt === "number" ? startedAt : Date.parse(startedAt);
    if (!Number.isFinite(this.startedAtMs)) {
      throw new Error("Run budget start time is invalid");
    }
  }

  get exhaustion(): RunBudgetExhaustion | undefined {
    return this.exhausted ? structuredClone(this.exhausted) : undefined;
  }

  observePrimaryUsage(
    usage: Usage,
    nowMs = Date.now(),
    accounting?: UsageAccounting,
  ): void {
    this.primaryTurns += 1;
    this.usage = addUsage(this.usage, usage);
    this.budgetTokens += usageBudgetTokens(usage, accounting);
    this.budgetCostUsd += usageBudgetCostUsd(usage, accounting);
    this.checkOverage(nowMs);
  }

  observeAuxiliaryUsage(
    usage: Usage,
    nowMs = Date.now(),
    accounting?: UsageAccounting,
  ): void {
    this.usage = addUsage(this.usage, usage);
    this.budgetTokens += usageBudgetTokens(usage, accounting);
    this.budgetCostUsd += usageBudgetCostUsd(usage, accounting);
    this.checkOverage(nowMs);
  }

  syncSubagentUsage(tasks: SubagentTask[], nowMs = Date.now()): void {
    for (const task of tasks) {
      const previous = this.subagentUsage.get(task.id) ?? emptyUsage();
      const delta = positiveUsageDelta(task.usage, previous);
      this.usage = addUsage(this.usage, delta);
      this.budgetTokens += usageBudgetTokens(delta);
      this.budgetCostUsd += usageBudgetCostUsd(delta);
      this.subagentUsage.set(task.id, structuredClone(task.usage));
    }
    this.checkOverage(nowMs);
  }

  assertCanStartPrimaryTurn(nowMs = Date.now()): void {
    this.exhaustUnavailableBudget(true, nowMs);
    this.throwIfExhausted();
  }

  assertCanStartAuxiliaryCall(nowMs = Date.now()): void {
    this.exhaustUnavailableBudget(false, nowMs);
    this.throwIfExhausted();
  }

  canStartOptionalAuxiliaryCall(nowMs = Date.now()): boolean {
    return (
      !this.exhausted &&
      this.elapsedMs(nowMs) < this.limits.timeoutMs &&
      this.budgetTokens < this.limits.maxTotalTokens &&
      this.budgetCostUsd < this.limits.maxCostUsd
    );
  }

  exhaustBeforeNextPrimaryTurn(
    nowMs = Date.now(),
  ): RunBudgetExhaustion | undefined {
    this.exhaustUnavailableBudget(true, nowMs);
    return this.exhaustion;
  }

  exhaustTimeout(nowMs = Date.now()): RunBudgetExhaustion {
    return this.exhaust(
      "timeout",
      this.limits.timeoutMs,
      Math.max(this.limits.timeoutMs, this.elapsedMs(nowMs)),
      nowMs,
    );
  }

  remainingTimeoutMs(nowMs = Date.now()): number {
    return Math.max(0, this.limits.timeoutMs - this.elapsedMs(nowMs));
  }

  observed(nowMs = Date.now()): RunBudgetObserved {
    return {
      turns: this.primaryTurns,
      totalTokens: this.budgetTokens,
      rawTotalTokens: totalRawTokens(this.usage),
      costUsd: this.budgetCostUsd,
      rawCostUsd: this.usage.costUsd,
      elapsedMs: this.elapsedMs(nowMs),
      usage: structuredClone(this.usage),
    };
  }

  throwIfExhausted(): void {
    if (this.exhausted) {
      throw new RunBudgetExceededError(structuredClone(this.exhausted));
    }
  }

  private checkOverage(nowMs: number): void {
    if (this.exhausted) return;
    const observed = this.observed(nowMs);
    if (observed.elapsedMs >= this.limits.timeoutMs) {
      this.exhaustTimeout(nowMs);
    } else if (observed.totalTokens > this.limits.maxTotalTokens) {
      this.exhaust(
        "tokens",
        this.limits.maxTotalTokens,
        observed.totalTokens,
        nowMs,
      );
    } else if (observed.costUsd > this.limits.maxCostUsd) {
      this.exhaust("cost", this.limits.maxCostUsd, observed.costUsd, nowMs);
    }
  }

  private exhaustUnavailableBudget(includeTurns: boolean, nowMs: number): void {
    if (this.exhausted) return;
    const observed = this.observed(nowMs);
    if (observed.elapsedMs >= this.limits.timeoutMs) {
      this.exhaustTimeout(nowMs);
    } else if (includeTurns && observed.turns >= this.limits.maxTurns) {
      this.exhaust("turns", this.limits.maxTurns, observed.turns, nowMs);
    } else if (observed.totalTokens >= this.limits.maxTotalTokens) {
      this.exhaust(
        "tokens",
        this.limits.maxTotalTokens,
        observed.totalTokens,
        nowMs,
      );
    } else if (observed.costUsd >= this.limits.maxCostUsd) {
      this.exhaust("cost", this.limits.maxCostUsd, observed.costUsd, nowMs);
    }
  }

  private exhaust(
    reason: RunBudgetReason,
    limit: number,
    amount: number,
    nowMs: number,
  ): RunBudgetExhaustion {
    if (this.exhausted) return this.exhausted;
    const label = {
      turns: "model turns",
      tokens: "total tokens",
      cost: "cost USD",
      timeout: "wall time ms",
    }[reason];
    this.exhausted = {
      reason,
      limit,
      observed: this.observed(nowMs),
      message: `Run budget exhausted: ${label} ${formatAmount(amount)} / ${formatAmount(limit)}`,
    };
    return this.exhausted;
  }

  private elapsedMs(nowMs: number): number {
    return Math.max(0, nowMs - this.startedAtMs);
  }
}

function addUsage(left: Usage, right: Usage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    costUsd: left.costUsd + right.costUsd,
  };
}

function positiveUsageDelta(current: Usage, previous: Usage): Usage {
  return {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    cacheReadTokens: Math.max(
      0,
      current.cacheReadTokens - previous.cacheReadTokens,
    ),
    cacheWriteTokens: Math.max(
      0,
      current.cacheWriteTokens - previous.cacheWriteTokens,
    ),
    costUsd: Math.max(0, current.costUsd - previous.costUsd),
  };
}

function formatAmount(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}
