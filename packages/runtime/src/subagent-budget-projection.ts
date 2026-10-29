import type { RunRecord } from "@napier/contracts";
import { RunBudgetTracker } from "./run-budget.js";

/** Logical admission only; predecessor usage is never written into this attempt. */
export function createSubagentRunBudget(run: RunRecord): RunBudgetTracker {
  const inherited = run.subagent?.continuation?.budget;
  const budget = new RunBudgetTracker(inherited?.limits ?? run.limits!, inherited?.originalStartedAt ?? run.startedAt);
  if (inherited) budget.observeAuxiliaryUsage(inherited.inheritedUsage);
  budget.observeAuxiliaryUsage(run.usage);
  return budget;
}
