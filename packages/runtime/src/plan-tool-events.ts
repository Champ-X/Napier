import type {
  ExecutionPlan,
  RunRecord,
  TransitionPlanStepRequest,
} from "@napier/contracts";

import type { LocalStore } from "./store.js";

export async function appendPlanCreatedEvent(
  store: LocalStore,
  run: RunRecord,
  plan: ExecutionPlan,
): Promise<void> {
  await store.appendEvent({
    threadId: run.threadId,
    runId: run.id,
    type: "plan.created",
    category: "plan",
    visibility: "user",
    payload: {
      planId: plan.id,
      objective: plan.objective,
      status: plan.status,
      stepCount: plan.steps.length,
      artifactCount: plan.artifacts.length,
      criticalPathStepIds: plan.criticalPathStepIds,
      readyStepIds: plan.readyStepIds,
      blockedStepIds: plan.blockedStepIds,
      activePhaseIndex: plan.activePhaseIndex,
      parallelReadyStepIds: plan.parallelReadyStepIds,
      phaseWaveCount: plan.phaseWaves.length,
      phaseProjectionSha256: plan.phaseProjectionSha256,
    },
  });
}

export async function appendPlanStepEvent(
  store: LocalStore,
  run: RunRecord,
  plan: ExecutionPlan,
  stepId: string,
  action: TransitionPlanStepRequest["action"],
): Promise<void> {
  const step = plan.steps.find((candidate) => candidate.id === stepId)!;
  await store.appendEvent({
    threadId: run.threadId,
    runId: run.id,
    type: `plan.step.${stepEventSuffix(action)}`,
    category: "plan",
    visibility: "user",
    payload: {
      planId: plan.id,
      stepId: step.id,
      title: step.title,
      status: step.status,
      planStatus: plan.status,
      criticalPathStepIds: plan.criticalPathStepIds,
      readyStepIds: plan.readyStepIds,
      blockedStepIds: plan.blockedStepIds,
      activePhaseIndex: plan.activePhaseIndex,
      parallelReadyStepIds: plan.parallelReadyStepIds,
      phaseWaveCount: plan.phaseWaves.length,
      phaseProjectionSha256: plan.phaseProjectionSha256,
      evidence: step.evidence,
      ...(step.blocker ? { blocker: step.blocker } : {}),
    },
  });
}

function stepEventSuffix(
  action: TransitionPlanStepRequest["action"],
): "blocked" | "completed" | "reopened" | "skipped" | "started" {
  if (action === "start") return "started";
  if (action === "complete") return "completed";
  if (action === "block") return "blocked";
  if (action === "skip") return "skipped";
  return "reopened";
}
