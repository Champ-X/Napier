import type { Api, Model } from "@earendil-works/pi-ai";
import type { RunRecord } from "@napier/contracts";
import type { RunBudgetTracker } from "./run-budget.js";
import { SubagentCoordinator, type SubagentCoordinatorOptions } from "./subagents.js";
export type { SubagentCoordinator } from "./subagents.js";

export function createAgentSubagents(
  options: Omit<SubagentCoordinatorOptions, "model"> & { model: Model<Api> | undefined },
  access: { restricted: boolean; degraded: boolean },
  inspection: true | undefined,
): SubagentCoordinator | undefined {
  if (!options.model || access.degraded || (access.restricted && (options.run.source !== "recovery" || inspection))) return;
  return new SubagentCoordinator({ ...options, model: options.model });
}

export async function prepareAgentSubagentRecovery(coordinator: SubagentCoordinator | undefined,
  store: Pick<SubagentCoordinatorOptions["store"], "getAgent">, run: RunRecord, budget: RunBudgetTracker, inspection: true | undefined): Promise<string> {
  if (!coordinator || run.source !== "recovery" || inspection) return "";
  return coordinator.resumeInterruptedChildren(store.getAgent(run.agentId), budget);
}

export { createSubagentModelCallServices } from "./subagent-model-call-services.js";
