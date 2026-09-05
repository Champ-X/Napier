import type {
  ExecutionPlan,
  RunRecord,
  TransitionPlanStepRequest,
} from "@napier/contracts";

import type { LocalStore } from "./store.js";
import { runPlanProgressEventPayload } from "./run-progress-plan-state.js";

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
      ...runPlanProgressEventPayload(plan),
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
      ...runPlanProgressEventPayload(plan),
      ...(step.blocker ? { blocker: step.blocker } : {}),
    },
  });
}

export async function appendPlanReplannedEvent(
  store: LocalStore,
  run: RunRecord,
  plan: ExecutionPlan,
): Promise<void> {
  const replan = plan.replans.at(-1)!;
  await store.appendEvent({
    threadId: run.threadId,
    runId: run.id,
    type: "plan.replanned",
    category: "plan",
    visibility: "user",
    payload: {
      planId: plan.id,
      replanId: replan.id,
      strategy: replan.strategy,
      fromRevision: replan.fromRevision,
      toRevision: replan.toRevision,
      replanSha256: replan.replanSha256,
      addedStepIds: replan.addedStepIds,
      addedArtifactIds: replan.addedArtifactIds,
      supersededStepIds: replan.supersededStepIds,
      supersededArtifactIds: replan.supersededArtifactIds,
      dependencyUpdatedStepIds: replan.dependencyUpdatedStepIds,
      addedStepsSha256: replan.addedStepsSha256,
      addedArtifactsSha256: replan.addedArtifactsSha256,
      dependencyUpdatesSha256: replan.dependencyUpdatesSha256,
      status: plan.status,
      criticalPathStepIds: plan.criticalPathStepIds,
      readyStepIds: plan.readyStepIds,
      blockedStepIds: plan.blockedStepIds,
      activePhaseIndex: plan.activePhaseIndex,
      parallelReadyStepIds: plan.parallelReadyStepIds,
      phaseWaveCount: plan.phaseWaves.length,
      phaseProjectionSha256: plan.phaseProjectionSha256,
      ...runPlanProgressEventPayload(plan),
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
