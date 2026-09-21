import type { Context, UserMessage } from "@earendil-works/pi-ai";
import { emptyUsage, type RunRecord } from "@napier/contracts";
import { expect, it } from "vitest";
import { RunBudgetTracker } from "../src/run-budget.js";
import { createUsageAccounting } from "../src/token-accounting.js";
import {
  createRunBudgetContext,
  runBudgetForContext,
} from "../src/run-budget-context.js";
import { prepareAgentInvocationContext } from "../src/agent-invocation-context.js";

const limits = {
  maxTurns: 40,
  maxTotalTokens: 250000,
  maxCostUsd: 3,
  timeoutMs: 900000,
};

it("updates remaining capacity after finalization entry without turning a forecast into extra budget", () => {
  const budget = new RunBudgetTracker(limits, 1000);
  budget.observeAuxiliaryUsage({ ...emptyUsage(), inputTokens: 163000 }, 1100);
  budget.observePrimaryUsage({ ...emptyUsage(), inputTokens: 20000 }, 1200);
  const initial = createRunBudgetContext(budget, 1300);
  expect(initial.phase).toBe("finalization");
  expect(initial.remaining.accountedTokens).toBe(67000);
  budget.observePrimaryUsage({ ...emptyUsage(), inputTokens: 40000 }, 1400);
  const next = createRunBudgetContext(budget, 1500);
  expect(next.phase).toBe("critical");
  expect(next.remaining.accountedTokens).toBe(27000);
  expect(next.forecast?.uncachedCallTokens).toBe(40000);
  expect(initial.remaining.accountedTokens).toBe(67000);
  expect(next.guidance).toContain("preserve mandatory verification");
  expect(next.guidance).toContain("disclose incomplete work");
  budget.observePrimaryUsage({ ...emptyUsage(), inputTokens: 27001 }, 1600);
  expect(createRunBudgetContext(budget, 1700).phase).toBe("exhausted");
  expect(() => budget.assertCanStartPrimaryTurn(1800)).toThrow(
    "budget exhausted",
  );
  expect(budget.limits).toEqual(limits);
});

it("distinguishes accounted cache-discounted tokens from an uncached forecast", () => {
  const budget = new RunBudgetTracker(limits, 1000);
  const usage = {
    ...emptyUsage(),
    inputTokens: 1000,
    outputTokens: 1000,
    cacheReadTokens: 23000,
  };
  const accounting = createUsageAccounting(
    { provider: "deepseek", id: "deepseek-v4-flash" },
    usage,
  );
  budget.observePrimaryUsage(usage, 1100, accounting);
  const snapshot = createRunBudgetContext(budget, 1200);
  expect(snapshot.observed.accountedTokens).toBe(accounting.budgetTokens);
  expect(snapshot.remaining.accountedTokens).toBe(
    250000 - accounting.budgetTokens,
  );
  expect(snapshot.forecast?.uncachedCallTokens).toBe(25000);
  expect(snapshot.guidance).toContain("not a guaranteed remaining call count");
  expect(snapshot.guidance).toContain("provider invoice");
});

it("keeps each request snapshot immutable and off the durable user transcript", async () => {
  const message: UserMessage = {
    role: "user",
    timestamp: 1,
    content: "Preserve required checks.",
  };
  const context: Context = { messages: [message] };
  const budget = new RunBudgetTracker(limits);
  const input = {
    context,
    run: { id: "r", threadId: "t" } as RunRecord,
    store: { workspaceRoot: "/unused" } as never,
    policy: {
      prompt: "stable-v1",
      memory: "legacy",
      workingState: "legacy",
      finalization: "request-aware-v2",
    } as const,
    budget,
  };
  const first = await prepareAgentInvocationContext(input);
  const firstText = runBudgetForContext(first);
  budget.observePrimaryUsage({ ...emptyUsage(), inputTokens: 1234 });
  const next = await prepareAgentInvocationContext(input);
  expect(first).not.toBe(next);
  expect(runBudgetForContext(first)).toBe(firstText);
  expect(JSON.parse(runBudgetForContext(next)).remaining.accountedTokens).toBe(
    248766,
  );
  expect(first.messages).toBe(context.messages);
  expect(next.messages).toEqual([message]);
  expect(runBudgetForContext(context)).toBe("");
  await expect(
    prepareAgentInvocationContext({ ...input, budget: undefined }),
  ).rejects.toThrow("current Run tracker");
  const legacy = await prepareAgentInvocationContext({
    ...input,
    policy: { ...input.policy, finalization: "request-aware-v1" },
  });
  expect(legacy).toBe(context);
  expect(runBudgetForContext(legacy)).toBe("");
});

it("refreshes auxiliary spending and elapsed time without needing another primary response", () => {
  const budget = new RunBudgetTracker(limits, 1000);
  budget.observeAuxiliaryUsage(
    { ...emptyUsage(), inputTokens: 500, costUsd: 2.9 },
    1100,
  );
  const snapshot = createRunBudgetContext(budget, 899000);
  expect(snapshot.phase).toBe("critical");
  expect(snapshot.forecast).toBeNull();
  expect(snapshot.remaining.seconds).toBe(2);
  expect(snapshot.remaining.accountedTokens).toBe(249500);
  expect(snapshot.remaining.accountedCostUsd).toBeCloseTo(0.1);
  expect(snapshot.observed.primaryTurns).toBe(0);
});

it("represents unlimited tokens as null remaining without creating a critical phase", () => {
  const budget = new RunBudgetTracker({ ...limits, maxTotalTokens: 0 }, 1000);
  budget.observePrimaryUsage(
    { ...emptyUsage(), inputTokens: 20_000_000 },
    1100,
  );
  const context = createRunBudgetContext(budget, 1200);
  expect(context.remaining.accountedTokens).toBeNull();
  expect(context.phase).toBe("working");
  expect(context.observed.accountedTokens).toBe(20_000_000);
});
