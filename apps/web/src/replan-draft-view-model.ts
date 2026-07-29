import type { ExecutionPlanReplanRecommendation } from "@napier/contracts";

export interface ReplanDraftStepProjection {
  id: string;
  title: string;
  dependsOn: string[];
}

export interface ReplanDraftArtifactProjection {
  id: string;
  path: string;
  kind: string;
}

export interface ReplanDraftDependencyProjection {
  stepId: string;
  dependsOn: string[];
}

export interface ReplanDraftSummaryProjection {
  expectedRevision: number;
  supersededStepIds: string[];
  supersededArtifactIds: string[];
  addedSteps: ReplanDraftStepProjection[];
  addedArtifacts: ReplanDraftArtifactProjection[];
  dependencyUpdates: ReplanDraftDependencyProjection[];
  structuralChangeCount: number;
  hasStructuralChanges: boolean;
}

export function projectReplanDraftSummary(
  recommendation: ExecutionPlanReplanRecommendation,
): ReplanDraftSummaryProjection {
  const request = recommendation.draft.request;
  const supersededStepIds = [...(request.supersedeStepIds ?? [])];
  const supersededArtifactIds = [...(request.supersedeArtifactIds ?? [])];
  const addedSteps = (request.addSteps ?? []).map((step) => ({
    id: step.id,
    title: step.title,
    dependsOn: [...(step.dependsOn ?? [])],
  }));
  const addedArtifacts = (request.addArtifacts ?? []).map((artifact) => ({
    id: artifact.id,
    path: artifact.path,
    kind: artifact.kind ?? "file",
  }));
  const dependencyUpdates = (request.dependencyUpdates ?? []).map((update) => ({
    stepId: update.stepId,
    dependsOn: [...update.dependsOn],
  }));
  const structuralChangeCount =
    supersededStepIds.length +
    supersededArtifactIds.length +
    addedSteps.length +
    addedArtifacts.length +
    dependencyUpdates.length;
  return {
    expectedRevision: request.expectedRevision,
    supersededStepIds,
    supersededArtifactIds,
    addedSteps,
    addedArtifacts,
    dependencyUpdates,
    structuralChangeCount,
    hasStructuralChanges: structuralChangeCount > 0,
  };
}
