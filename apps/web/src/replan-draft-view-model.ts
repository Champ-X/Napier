import type {
  ExecutionPlan,
  ExecutionPlanReplanRecommendation,
  ExecutionPlanReplanRecord,
} from "@napier/contracts";

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

export interface ReplanRecordSummaryProjection {
  supersededStepIds: string[];
  supersededArtifactIds: string[];
  addedStepIds: string[];
  addedArtifactIds: string[];
  dependencyUpdatedStepIds: string[];
  structuralChangeCount: number;
  hasStructuralChanges: boolean;
  addedStepsSha256: string;
  addedArtifactsSha256: string;
  dependencyUpdatesSha256: string;
  replanSha256: string;
}

export interface ReplanHistoryRecordProjection {
  id: string;
  strategy: ExecutionPlanReplanRecord["strategy"];
  fromRevision: number;
  toRevision: number;
  structuralChangeCount: number;
  replanSha256: string;
}

export interface ReplanHistorySummaryProjection {
  recordCount: number;
  totalStructuralChangeCount: number;
  records: ReplanHistoryRecordProjection[];
  hasHistory: boolean;
  hasMultipleRecords: boolean;
}

export type ReplanStepRole = "added" | "dependency_updated" | "superseded";

export type ReplanArtifactRole = "added" | "superseded";

export interface ReplanRecoveryProgressProjection {
  addedStepCount: number;
  settledStepCount: number;
  readyStepCount: number;
  runningStepCount: number;
  blockedStepCount: number;
  addedArtifactCount: number;
  verifiedArtifactCount: number;
  producedArtifactCount: number;
  missingArtifactCount: number;
  pendingArtifactCount: number;
  hasRecoveryWork: boolean;
  isComplete: boolean;
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

export function projectReplanRecordSummary(
  record: ExecutionPlanReplanRecord,
): ReplanRecordSummaryProjection {
  const supersededStepIds = [...record.supersededStepIds];
  const supersededArtifactIds = [...record.supersededArtifactIds];
  const addedStepIds = [...record.addedStepIds];
  const addedArtifactIds = [...record.addedArtifactIds];
  const dependencyUpdatedStepIds = [...record.dependencyUpdatedStepIds];
  const structuralChangeCount =
    supersededStepIds.length +
    supersededArtifactIds.length +
    addedStepIds.length +
    addedArtifactIds.length +
    dependencyUpdatedStepIds.length;
  return {
    supersededStepIds,
    supersededArtifactIds,
    addedStepIds,
    addedArtifactIds,
    dependencyUpdatedStepIds,
    structuralChangeCount,
    hasStructuralChanges: structuralChangeCount > 0,
    addedStepsSha256: record.addedStepsSha256,
    addedArtifactsSha256: record.addedArtifactsSha256,
    dependencyUpdatesSha256: record.dependencyUpdatesSha256,
    replanSha256: record.replanSha256,
  };
}

export function projectReplanHistorySummary(
  records: readonly ExecutionPlanReplanRecord[],
): ReplanHistorySummaryProjection {
  const projectedRecords = records.map((record) => {
    const summary = projectReplanRecordSummary(record);
    return {
      id: record.id,
      strategy: record.strategy,
      fromRevision: record.fromRevision,
      toRevision: record.toRevision,
      structuralChangeCount: summary.structuralChangeCount,
      replanSha256: summary.replanSha256,
    };
  });
  return {
    recordCount: projectedRecords.length,
    totalStructuralChangeCount: projectedRecords.reduce(
      (total, record) => total + record.structuralChangeCount,
      0,
    ),
    records: projectedRecords,
    hasHistory: projectedRecords.length > 0,
    hasMultipleRecords: projectedRecords.length > 1,
  };
}

export function projectReplanStepRoles(
  stepId: string,
  record: ExecutionPlanReplanRecord | undefined,
): ReplanStepRole[] {
  if (!record) return [];
  const roles: ReplanStepRole[] = [];
  if (record.addedStepIds.includes(stepId)) roles.push("added");
  if (record.dependencyUpdatedStepIds.includes(stepId)) {
    roles.push("dependency_updated");
  }
  if (record.supersededStepIds.includes(stepId)) roles.push("superseded");
  return roles;
}

export function projectReplanArtifactRoles(
  artifactId: string,
  record: ExecutionPlanReplanRecord | undefined,
): ReplanArtifactRole[] {
  if (!record) return [];
  const roles: ReplanArtifactRole[] = [];
  if (record.addedArtifactIds.includes(artifactId)) roles.push("added");
  if (record.supersededArtifactIds.includes(artifactId)) {
    roles.push("superseded");
  }
  return roles;
}

export function projectReplanRecoveryProgress(
  plan: Pick<ExecutionPlan, "steps" | "artifacts">,
  record: ExecutionPlanReplanRecord | undefined,
): ReplanRecoveryProgressProjection | undefined {
  if (!record) return undefined;
  const addedStepIds = new Set(record.addedStepIds);
  const addedArtifactIds = new Set(record.addedArtifactIds);
  const steps = plan.steps.filter((step) => addedStepIds.has(step.id));
  const artifacts = plan.artifacts.filter((artifact) =>
    addedArtifactIds.has(artifact.id),
  );
  const settledStepCount = steps.filter(
    (step) => step.status === "completed" || step.status === "skipped",
  ).length;
  const readyStepCount = steps.filter((step) => step.status === "ready").length;
  const runningStepCount = steps.filter(
    (step) => step.status === "running",
  ).length;
  const blockedStepCount = steps.filter(
    (step) => step.status === "blocked",
  ).length;
  const verifiedArtifactCount = artifacts.filter(
    (artifact) => artifact.status === "verified",
  ).length;
  const producedArtifactCount = artifacts.filter(
    (artifact) => artifact.status === "produced",
  ).length;
  const missingArtifactCount = artifacts.filter(
    (artifact) => artifact.status === "missing",
  ).length;
  const pendingArtifactCount = artifacts.filter(
    (artifact) => artifact.status === "expected",
  ).length;
  return {
    addedStepCount: record.addedStepIds.length,
    settledStepCount,
    readyStepCount,
    runningStepCount,
    blockedStepCount,
    addedArtifactCount: record.addedArtifactIds.length,
    verifiedArtifactCount,
    producedArtifactCount,
    missingArtifactCount,
    pendingArtifactCount,
    hasRecoveryWork:
      record.addedStepIds.length > 0 || record.addedArtifactIds.length > 0,
    isComplete:
      record.addedStepIds.length === settledStepCount &&
      record.addedArtifactIds.length === verifiedArtifactCount,
  };
}
