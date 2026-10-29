import type { RunRecord } from "@napier/contracts";

/** Read immutable predecessor attempts without copying their debits into the successor projection. */
export function inheritedModelAccountingBudget(run: RunRecord, runs: readonly RunRecord[]): { budgetTokens: number; knownBudgetCostUsd: number } {
  let predecessorId = run.subagent?.continuation?.predecessorRunId;
  const seen = new Set([run.id]);
  let budgetTokens = 0, knownBudgetCostUsd = 0;
  while (predecessorId) {
    const predecessor = runs.find((value) => value.id === predecessorId);
    if (!predecessor || seen.has(predecessor.id)) throw new Error("Model accounting predecessor budget lineage is unavailable");
    seen.add(predecessor.id);
    budgetTokens += predecessor.accounting?.budgetTokens ?? (predecessor.usage.inputTokens + predecessor.usage.outputTokens +
      predecessor.usage.cacheReadTokens + predecessor.usage.cacheWriteTokens);
    knownBudgetCostUsd += predecessor.accounting?.knownBudgetCostUsd ?? predecessor.usage.costUsd;
    predecessorId = predecessor.subagent?.continuation?.predecessorRunId;
  }
  return { budgetTokens, knownBudgetCostUsd };
}
