import { emptyUsage, type RunRecord, type Usage } from "@napier/contracts";
import { RunBudgetTracker } from "./run-budget.js";
import type { RunAccountingBudgetSnapshot } from "./model-accounting-registry.js";
import { inheritedModelAccountingBudget } from "./model-accounting-inherited-budget.js";

/** Logical admission only; predecessor debits never enter this attempt's durable usage. */
export function createSubagentRunBudget(run: RunRecord, runs: readonly RunRecord[] = [], turnCount = 0): RunBudgetTracker {
  const inherited = run.subagent?.continuation?.budget;
  const budget = new RunBudgetTracker(inherited?.limits ?? run.limits!, inherited?.originalStartedAt ?? run.startedAt,
    turnCount + (inherited?.inheritedTurnCount ?? 0));
  if (run.accounting) budget.adoptAccounting(subagentAdmissionAccounting(run, {
    accountingRevision: run.accounting.revision, usage: run.usage, summary: run.accounting,
    knownBudgetCostUsd: run.accounting.knownBudgetCostUsd,
  }, runs));
  else {
    if (inherited) budget.observeAuxiliaryUsage(inherited.inheritedUsage);
    budget.observeAuxiliaryUsage(run.usage);
  }
  return budget;
}

export function subagentAdmissionAccounting(run: RunRecord, snapshot: RunAccountingBudgetSnapshot,
  runs: readonly RunRecord[]): RunAccountingBudgetSnapshot {
  const inherited = inheritedModelAccountingBudget(run, runs);
  const prior = run.subagent?.continuation?.budget.inheritedUsage ?? emptyUsage();
  const usage: Usage = {
    inputTokens: snapshot.usage.inputTokens + prior.inputTokens,
    outputTokens: snapshot.usage.outputTokens + prior.outputTokens,
    cacheReadTokens: snapshot.usage.cacheReadTokens + prior.cacheReadTokens,
    cacheWriteTokens: snapshot.usage.cacheWriteTokens + prior.cacheWriteTokens,
    costUsd: snapshot.usage.costUsd + prior.costUsd,
  };
  return { accountingRevision: snapshot.accountingRevision, usage,
    knownBudgetCostUsd: (snapshot.knownBudgetCostUsd ?? snapshot.summary.budgetCostUsd ?? snapshot.usage.costUsd) + inherited.knownBudgetCostUsd,
    summary: { budgetTokens: snapshot.summary.budgetTokens + inherited.budgetTokens,
      budgetCostUsd: snapshot.summary.budgetCostUsd === null ? null : snapshot.summary.budgetCostUsd + inherited.knownBudgetCostUsd } };
}
