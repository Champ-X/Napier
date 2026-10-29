import type { ExecutionPlan } from "./execution-plan-v1.js";
import type { ThreadDetail } from "./workspace-bootstrap-v1.js";
import {
  taskArtifactHistory,
  type TaskArtifactHistoryEvent,
} from "./task-artifact-history.js";

type Deliverable = NonNullable<
  NonNullable<ThreadDetail["taskNarrative"]>["deliverables"]
>[number] & { source: "plan"; planId: string; planRevision: number };

/** Pick current metadata per resource, including unavailable declarations.
 * Recover emitted metadata versions without claiming a complete byte archive. */
export function projectTaskDeliverables(
  plans: readonly ExecutionPlan[],
  options: {
    preferredPaths?: readonly string[];
    history?: readonly TaskArtifactHistoryEvent[];
  } = {},
): Deliverable[] {
  const preferred = (options.preferredPaths ?? []).map((value) =>
    resourceKey(value, "file"),
  );
  const priority = (value: string) => {
    const index = preferred.indexOf(resourceKey(value, "file"));
    return index < 0 ? preferred.length : index;
  };
  const versions = new Map<string, Deliverable[]>();
  for (const plan of plans) {
    for (const artifact of plan.artifacts) {
      const key = resourceKey(artifact.path, artifact.kind);
      const entries = versions.get(key) ?? [];
      entries.push({
        path: artifact.path,
        planId: plan.id,
        planRevision: plan.revision,
        artifact,
        source: "plan",
        verification: "unverified",
        accessibility: artifact.status === "missing" ? "missing" : "unchecked",
        ...taskArtifactHistory(plan, artifact, options.history ?? []),
      });
      versions.set(key, entries);
    }
  }
  return [...versions.values()]
    .map((entries) => {
      entries.sort(
        (left, right) =>
          right.artifact.updatedAt.localeCompare(left.artifact.updatedAt) ||
          right.artifact.createdAt.localeCompare(left.artifact.createdAt) ||
          right.planRevision - left.planRevision ||
          right.artifact.id.localeCompare(left.artifact.id),
      );
      const [latest, ...older] = entries;
      return {
        ...latest!,
        previousVersions: [
          ...latest!.previousVersions,
          ...older.flatMap((entry) => [
            {
              planId: entry.planId,
              artifactId: entry.artifact.id,
              planRevision: entry.planRevision,
              path: entry.path,
              source: "manifest" as const,
              ...entry.currentVersion,
              ...(entry.artifact.sourceRunId
                ? { runId: entry.artifact.sourceRunId }
                : {}),
              ...(entry.artifact.sha256
                ? { sha256: entry.artifact.sha256 }
                : {}),
            },
            ...entry.previousVersions,
          ]),
        ],
      };
    })
    .sort(
      (left, right) =>
        priority(left.path) - priority(right.path) ||
        right.artifact.updatedAt.localeCompare(left.artifact.updatedAt) ||
        left.path.localeCompare(right.path),
    );
}

function resourceKey(value: string, kind: string): string {
  if (kind === "url") return value;
  const segments: string[] = [];
  for (const segment of value.replaceAll("\\", "/").split("/")) {
    if (segment === ".") continue;
    if (segment === ".." && segments.length > 0 && segments.at(-1) !== "..")
      segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}
