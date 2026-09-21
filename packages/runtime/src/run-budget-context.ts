import type { Context } from "@earendil-works/pi-ai";
import type { RunBudgetTracker } from "./run-budget.js";

const contexts = new WeakMap<Context, string>();

/** Request-local accounting data, never a task-success or tool-admission decision. */
export function createRunBudgetContext(
  budget: RunBudgetTracker,
  nowMs = Date.now(),
) {
  const observed = budget.observed(nowMs);
  const limits = budget.limits;
  const remaining = {
    primaryTurns: Math.max(0, limits.maxTurns - observed.turns),
    accountedTokens:
      limits.maxTotalTokens === 0
        ? null
        : Math.max(0, limits.maxTotalTokens - observed.totalTokens),
    accountedCostUsd: Math.max(0, limits.maxCostUsd - observed.costUsd),
    seconds: Math.max(
      0,
      Math.floor((limits.timeoutMs - observed.elapsedMs) / 1000),
    ),
  };
  const forecast = budget.primaryRequestForecast();
  const reserve = budget.finalizationReserveBeforeNextPrimaryTurn(nowMs, true);
  const phase = budget.exhaustion
    ? "exhausted"
    : remaining.primaryTurns <= 2 ||
        remaining.seconds <= 30 ||
        remaining.accountedCostUsd <= limits.maxCostUsd * 0.1 ||
        (remaining.accountedTokens !== null &&
          remaining.accountedTokens <= (forecast?.uncachedCallTokens ?? 0) * 2)
      ? "critical"
      : reserve
        ? "finalization"
        : "working";
  return {
    kind: "napier.run-budget-context",
    schemaVersion: 1,
    policy: "request-aware-v2",
    phase,
    limits: structuredClone(limits),
    remaining,
    observed: {
      primaryTurns: observed.turns,
      inFlightPrimaryTurns: observed.inFlightTurns,
      accountedTokens: observed.totalTokens,
      accountedCostUsd: observed.costUsd,
    },
    forecast: forecast
      ? {
          sampleCount: forecast.sampleCount,
          uncachedCallTokens: forecast.uncachedCallTokens,
        }
      : null,
    guidance: [
      "Token limit 0 and remaining accountedTokens null mean unlimited cumulative tokens. Current Run accounting only; this snapshot grants no extra budget, permissions, or task completion. Hard limits remain enforced. Remaining primary turns exclude already-started calls; in-flight response usage is not yet known. Cache reuse is uncertain; the recent uncached-call estimate is not a guaranteed remaining call count or a provider invoice.",
      phase === "critical" || phase === "finalization"
        ? "If required changes and verification are already supported by current evidence, deliver the concise final answer now. Otherwise complete only essential remaining actions within the user's scope, and disclose incomplete work. Avoid optional test expansion and cosmetic plan bookkeeping; preserve mandatory verification and later user instructions."
        : "Plan essential work and verification with enough capacity left for a final response. Reassess this current snapshot before expanding optional work.",
    ].join(" "),
  };
}

export function bindRunBudgetContext(
  context: Context,
  budget: RunBudgetTracker,
): void {
  contexts.set(context, JSON.stringify(createRunBudgetContext(budget)));
}

export function runBudgetForContext(context: Context): string {
  return contexts.get(context) ?? "";
}
