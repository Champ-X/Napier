import type {
  ArtifactManifestEntry,
  ExecutionPlan,
  ThreadDetail,
} from "@napier/contracts";
import { projectTaskDeliverables } from "@napier/contracts/task-narrative";

export interface TaskArtifactTarget {
  path: string;
  planId?: string;
  artifact?: ArtifactManifestEntry;
}

type ActivePlanOutputs = Pick<
  NonNullable<ThreadDetail["activePlan"]>,
  "outputPaths"
> &
  Partial<Pick<NonNullable<ThreadDetail["activePlan"]>, "planId">>;
type Deliverables = NonNullable<ThreadDetail["taskNarrative"]>["deliverables"];

export function taskArtifactTargets(
  plans: readonly ExecutionPlan[],
  activePlan?: ActivePlanOutputs,
  deliverables?: Deliverables,
): TaskArtifactTarget[] {
  const projected = deliverables ?? projectTaskDeliverables(plans);
  const targets: TaskArtifactTarget[] = projected
    .filter(
      (entry) =>
        entry.artifact.status === "produced" ||
        entry.artifact.status === "verified",
    )
    .map(({ path, planId, artifact }) => ({ path, planId, artifact }));
  // Historical snapshots may contain only outputPaths. An empty list never
  // hides declared artifacts, and a known missing/replaced version stays closed.
  for (const path of activePlan?.outputPaths ?? []) {
    if (projected.some((entry) => entry.path === path)) continue;
    targets.push({ path });
  }
  return targets;
}

export function taskArtifactPaths(
  plans: readonly ExecutionPlan[],
  activePlan?: ActivePlanOutputs,
  deliverables?: Deliverables,
): string[] {
  return taskArtifactTargets(plans, activePlan, deliverables).map(
    (target) => target.path,
  );
}
