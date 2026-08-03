import type { ExecutionPlan } from "@napier/contracts";
import type { LocalStore } from "@napier/runtime";

export type PlanArtifactHttpStore = Pick<
  LocalStore,
  "appendEvent" | "getPlan" | "workspaceRoot"
>;

export function getThreadPlan(
  store: PlanArtifactHttpStore,
  planId: string,
  threadId: string,
): ExecutionPlan {
  const plan = store.getPlan(planId);
  if (plan.threadId !== threadId) {
    throw new Error(`Plan not found in thread: ${planId}`);
  }
  return plan;
}
