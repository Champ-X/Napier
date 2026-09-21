import type {
  ExecutionPlan,
  ExecutionPlanReplanPolicyTemplate,
} from "@napier/contracts";
import { createTaskPlanSnapshot } from "./task-plan-snapshot.js";

export function planToolResult<TDetails>(
  plan: ExecutionPlan,
  details: TDetails,
  replanPolicyTemplate: ExecutionPlanReplanPolicyTemplate,
): {
  content: Array<{ type: "text"; text: string }>;
  details: TDetails & {
    planState: ReturnType<typeof createTaskPlanSnapshot>;
  };
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          planId: plan.id,
          status: plan.status,
          revision: plan.revision,
          replanCount: plan.replans.length,
          latestReplanSha256: plan.replans.at(-1)?.replanSha256,
          replanRecommendation: plan.replanRecommendation
            ? {
                strategy: plan.replanRecommendation.strategy,
                expectedRevision: plan.replanRecommendation.expectedRevision,
                supersedeStepIds: plan.replanRecommendation.supersedeStepIds,
                supersedeArtifactIds:
                  plan.replanRecommendation.supersedeArtifactIds,
                affectedStepIds: plan.replanRecommendation.affectedStepIds,
                affectedArtifactIds:
                  plan.replanRecommendation.affectedArtifactIds,
                draft: plan.replanRecommendation.draft,
                policyTemplate: replanPolicyTemplate,
                recommendationSha256:
                  plan.replanRecommendation.recommendationSha256,
              }
            : null,
          criticalPathStepIds: plan.criticalPathStepIds,
          readyStepIds: plan.readyStepIds,
          blockedStepIds: plan.blockedStepIds,
          activePhaseIndex: plan.activePhaseIndex,
          parallelReadyStepIds: plan.parallelReadyStepIds,
          phaseWaveCount: plan.phaseWaves.length,
          phaseProjectionSha256: plan.phaseProjectionSha256,
          steps: plan.steps.map((step) => ({
            id: step.id,
            status: step.status,
          })),
          artifacts: plan.artifacts.map((artifact) => ({
            id: artifact.id,
            status: artifact.status,
          })),
        }),
      },
    ],
    details: { ...details, planState: createTaskPlanSnapshot(plan) },
  };
}
