import type { ModelAccountingHost } from "./model-accounting-host.js";
import { foldModelAccounting } from "./model-accounting-fold.js";
import { object, readModelAccountingEvidence } from "./model-accounting-evidence.js";
import { projectModelObservationUsage } from "./model-usage-observation.js";

export interface ModelRunBudgetExposure {
  accountedTokens: number;
  accountedCostUsd: number;
  reservedTokens: number;
  reservedCostUsd: number | null;
  unboundedInvocations: number;
}

/** Admission projection only: do not write reservations into canonical usage.
 * A physical invocation contributes once, including immutable child predecessors.
 * The caller holds the Store queue; its dispatch commit must CAS the same revision. */
export function modelRunBudgetExposure(host: ModelAccountingHost, runId: string): ModelRunBudgetExposure {
  const scope = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error("Model budget lineage contains a cycle");
    if (scope.has(id)) return;
    visiting.add(id);
    const run = host.mutableRun(id);
    for (const task of host.state.subagents.filter((value) => value.runId === id)) if (task.childRunId) {
      const child = host.mutableRun(task.childRunId);
      if (child.parentRunId !== id || child.subagent?.taskId !== task.id)
        throw new Error("Model budget child lineage is unavailable");
      visit(child.id);
    }
    if (run.subagent?.continuation) visit(run.subagent.continuation.predecessorRunId);
    visiting.delete(id); scope.add(id);
  };
  visit(runId);
  const result: ModelRunBudgetExposure = { accountedTokens: 0, accountedCostUsd: 0,
    reservedTokens: 0, reservedCostUsd: 0, unboundedInvocations: 0 };
  for (const id of scope) {
    const events = host.requireLedger().listRunEvents(id);
    // Native child Runs are folded independently; historical logical-only Tasks remain in their owner fold.
    const tasks = host.state.subagents.filter((task) => task.runId === id && !task.childRunId);
    const { summary } = foldModelAccounting(events, tasks);
    result.accountedTokens += summary.budgetTokens;
    result.accountedCostUsd += summary.knownBudgetCostUsd;
    if (tasks.some((task) => task.usageStatus === "incomplete")) result.unboundedInvocations += 1;
    const evidence = readModelAccountingEvidence(events);
    const entered = new Set(events.filter((event) => event.type === "model.accounting.dispatch_intent")
      .map((event) => String(object(event.payload)["physicalId"])));
    for (const attribution of evidence.attributions.values()) {
      if (!entered.has(attribution.physicalId)) continue;
      const observation = evidence.observations.get(attribution.physicalId);
      if (observation?.terminal === "undispatched") continue;
      const usage = observation ? projectModelObservationUsage(attribution, observation) : undefined;
      const tokensUncertain = !usage || usage.tokenCompleteness !== "complete";
      const costUncertain = !usage || usage.budgetCostCompleteness !== "complete";
      if (!tokensUncertain && !costUncertain) continue;
      const allowance = attribution.budgetAllowance;
      if (!allowance) { result.unboundedInvocations += 1; continue; }
      if (tokensUncertain) result.reservedTokens += Math.max(0, allowance.budgetTokens - (usage?.budgetTokens ?? 0));
      if (costUncertain) result.reservedCostUsd = result.reservedCostUsd === null || allowance.budgetCostUsd === null
        ? null : result.reservedCostUsd + Math.max(0, allowance.budgetCostUsd - (usage?.budgetCostUsd ?? usage?.usage.costUsd ?? 0));
    }
  }
  if (!Number.isSafeInteger(result.accountedTokens + result.reservedTokens) ||
    !Number.isFinite(result.accountedCostUsd + (result.reservedCostUsd ?? 0)))
    throw new Error("Model budget exposure exceeds safe precision");
  return result;
}
