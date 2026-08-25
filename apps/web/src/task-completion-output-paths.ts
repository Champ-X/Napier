import type { ExecutionPlan } from "@napier/contracts";

export function taskArtifactPaths(
  plans: readonly ExecutionPlan[],
  activePlan?: Pick<
    NonNullable<import("@napier/contracts").ThreadDetail["activePlan"]>,
    "outputPaths"
  >,
): string[] {
  if (activePlan) return activePlan.outputPaths;
  const plan =
    plans.findLast(
      (candidate) =>
        candidate.status === "active" || candidate.status === "blocked",
    ) ?? plans.findLast((candidate) => candidate.status === "completed");
  return (plan?.artifacts ?? [])
    .filter(
      (artifact) =>
        artifact.status === "produced" || artifact.status === "verified",
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 2)
    .map((artifact) => artifact.path);
}
