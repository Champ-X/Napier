import {
  emptyUsage,
  type RunLimits,
  type SubagentTask,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { RunBudgetExceededError, RunBudgetTracker } from "../src/run-budget.js";

const LIMITS: RunLimits = {
  maxTurns: 2,
  maxTotalTokens: 100,
  maxCostUsd: 1,
  timeoutMs: 10_000,
};

describe("RunBudgetTracker", () => {
  it("allows a final response at an exact token ceiling but blocks another call", () => {
    const budget = new RunBudgetTracker(LIMITS, 1_000);
    budget.observePrimaryUsage(
      {
        inputTokens: 70,
        outputTokens: 30,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.2,
      },
      1_100,
    );

    expect(budget.exhaustion).toBeUndefined();
    expect(budget.canStartOptionalAuxiliaryCall(1_100)).toBe(false);
    expect(() => budget.assertCanStartPrimaryTurn(1_100)).toThrow(
      RunBudgetExceededError,
    );
    expect(budget.exhaustion).toEqual(
      expect.objectContaining({ reason: "tokens", limit: 100 }),
    );
  });

  it("stops before a tool continuation would exceed the primary turn cap", () => {
    const budget = new RunBudgetTracker({ ...LIMITS, maxTurns: 1 }, 1_000);
    budget.observePrimaryUsage(
      {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      },
      1_100,
    );

    expect(budget.exhaustion).toBeUndefined();
    expect(budget.exhaustBeforeNextPrimaryTurn(1_100)).toEqual(
      expect.objectContaining({ reason: "turns", limit: 1 }),
    );
  });

  it("fails closed on cost overage and timeout with first reason preserved", () => {
    const costBudget = new RunBudgetTracker(LIMITS, 1_000);
    costBudget.observeAuxiliaryUsage(
      {
        ...emptyUsage(),
        costUsd: 1.01,
      },
      1_100,
    );
    expect(costBudget.exhaustion).toEqual(
      expect.objectContaining({ reason: "cost", limit: 1 }),
    );
    costBudget.exhaustTimeout(20_000);
    expect(costBudget.exhaustion?.reason).toBe("cost");

    const timedBudget = new RunBudgetTracker(LIMITS, 1_000);
    timedBudget.exhaustTimeout(11_000);
    expect(timedBudget.exhaustion).toEqual(
      expect.objectContaining({
        reason: "timeout",
        observed: expect.objectContaining({ elapsedMs: 10_000 }),
      }),
    );
  });

  it("accounts each subagent usage delta exactly once", () => {
    const budget = new RunBudgetTracker(LIMITS, 1_000);
    const task: SubagentTask = {
      id: "task_budget",
      threadId: "thread_budget",
      runId: "run_budget",
      role: "reviewer",
      description: "Review budget accounting",
      prompt: "Inspect the usage totals.",
      status: "completed",
      result: "Reviewed.",
      stopReason: "completed",
      model: { provider: "faux", id: "faux-1" },
      stepCount: 1,
      turnCount: 1,
      usage: {
        inputTokens: 6,
        outputTokens: 4,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.1,
      },
      createdAt: "2026-07-25T00:00:00.000Z",
      startedAt: "2026-07-25T00:00:00.000Z",
      finishedAt: "2026-07-25T00:00:01.000Z",
      revision: 3,
    };

    budget.syncSubagentUsage([task], 1_100);
    budget.syncSubagentUsage([task], 1_200);

    expect(budget.observed(1_200)).toEqual(
      expect.objectContaining({
        totalTokens: 10,
        costUsd: 0.1,
        usage: task.usage,
      }),
    );
  });

  it("uses calibrated budget tokens while preserving raw usage totals", () => {
    const budget = new RunBudgetTracker(
      { ...LIMITS, maxTotalTokens: 120 },
      1_000,
    );
    const usage = {
      inputTokens: 80,
      outputTokens: 20,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      costUsd: 0.2,
    };

    budget.observePrimaryUsage(usage, 1_100, {
      schemaVersion: 1,
      model: "openai/gpt-4.1",
      strategy: "openai_cache_discounted",
      rawTotalTokens: 180,
      budgetTokens: 120,
      reportedCostUsd: 0.2,
      estimatedCostUsd: 0.0004,
      budgetCostUsd: 0.2,
      costStrategy: "provider_reported_cost",
      priceTableId: "openai-compatible-default.v1",
      priceTableSha256: "b".repeat(64),
      inputWeight: 1,
      outputWeight: 1,
      cacheReadWeight: 0.25,
      cacheWriteWeight: 1,
      contentSha256: "a".repeat(64),
    });

    expect(budget.exhaustion).toBeUndefined();
    expect(budget.observed(1_100)).toEqual(
      expect.objectContaining({
        totalTokens: 120,
        rawTotalTokens: 180,
        costUsd: 0.2,
        rawCostUsd: 0.2,
        usage,
      }),
    );
    expect(budget.exhaustBeforeNextPrimaryTurn(1_100)).toEqual(
      expect.objectContaining({ reason: "tokens", limit: 120 }),
    );
  });

  it("uses calibrated budget cost when provider cost is missing", () => {
    const budget = new RunBudgetTracker(
      { ...LIMITS, maxTotalTokens: 10_000, maxCostUsd: 0.01 },
      1_000,
    );
    const usage = {
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    };

    budget.observeAuxiliaryUsage(usage, 1_100, {
      schemaVersion: 1,
      model: "anthropic/claude-3.5-sonnet",
      strategy: "anthropic_cache_discounted",
      rawTotalTokens: 1_500,
      budgetTokens: 1_500,
      reportedCostUsd: 0,
      estimatedCostUsd: 0.0105,
      budgetCostUsd: 0.0105,
      costStrategy: "price_table_estimate",
      priceTableId: "anthropic-default.v1",
      priceTableSha256: "c".repeat(64),
      inputWeight: 1,
      outputWeight: 1,
      cacheReadWeight: 0.1,
      cacheWriteWeight: 1.25,
      contentSha256: "d".repeat(64),
    });

    expect(budget.exhaustion).toEqual(
      expect.objectContaining({
        reason: "cost",
        limit: 0.01,
        observed: expect.objectContaining({
          costUsd: 0.0105,
          rawCostUsd: 0,
        }),
      }),
    );
  });
});
