import type { ArtifactManifestEntry, ExecutionPlan } from "@napier/contracts";

export interface TaskArtifactTarget {
  path: string;
  planId?: string;
  artifact?: ArtifactManifestEntry;
}

type ActivePlanOutputs = Pick<
  NonNullable<import("@napier/contracts").ThreadDetail["activePlan"]>,
  "outputPaths"
> &
  Partial<
    Pick<
      NonNullable<import("@napier/contracts").ThreadDetail["activePlan"]>,
      "planId"
    >
  >;

export function taskArtifactTargets(
  plans: readonly ExecutionPlan[],
  activePlan?: ActivePlanOutputs,
): TaskArtifactTarget[] {
  if (activePlan) {
    const plan = activePlan.planId
      ? plans.find((candidate) => candidate.id === activePlan.planId)
      : undefined;
    return activePlan.outputPaths.map((path) => {
      const artifact = plan?.artifacts.find(
        (candidate) => candidate.path === path,
      );
      return {
        path,
        ...(plan && artifact ? { planId: plan.id, artifact } : {}),
      };
    });
  }
  const plan = selectTaskOutputPlan(plans);
  return (plan?.artifacts ?? [])
    .filter(isAvailableArtifact)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 2)
    .map((artifact) => ({ path: artifact.path, planId: plan!.id, artifact }));
}

export function taskArtifactPaths(
  plans: readonly ExecutionPlan[],
  activePlan?: ActivePlanOutputs,
): string[] {
  return taskArtifactTargets(plans, activePlan).map((target) => target.path);
}

function selectTaskOutputPlan(plans: readonly ExecutionPlan[]) {
  return (
    plans.findLast(
      (candidate) =>
        candidate.status === "active" || candidate.status === "blocked",
    ) ?? plans.findLast((candidate) => candidate.status === "completed")
  );
}

function isAvailableArtifact(artifact: ArtifactManifestEntry): boolean {
  return artifact.status === "produced" || artifact.status === "verified";
}
