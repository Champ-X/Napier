import type { ExecutionPlan } from "./execution-plan-v1.js";
import type { ThreadDetail } from "./workspace-bootstrap-v1.js";

type Deliverable = NonNullable<
  NonNullable<ThreadDetail["taskNarrative"]>["deliverables"]
>[number];

/** All declared versions remain in the ledger; the task surface picks the latest
 * version per resource, including unavailable versions so it cannot resurrect an
 * older verified version after that same path was replaced or went missing. */
export function projectTaskDeliverables(
  plans: readonly ExecutionPlan[],
  options: { preferredPaths?: readonly string[] } = {},
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
        verification:
          artifact.status === "verified" ? "integrity_recorded" : "unverified",
        accessibility: artifact.status === "missing" ? "missing" : "unchecked",
        previousVersions: [],
      });
      versions.set(key, entries);
    }
  }
  return [...versions.values()]
    .map((entries) => {
      entries.sort(
        (left, right) =>
          right.artifact.createdAt.localeCompare(left.artifact.createdAt) ||
          right.artifact.updatedAt.localeCompare(left.artifact.updatedAt) ||
          right.planRevision - left.planRevision ||
          right.artifact.id.localeCompare(left.artifact.id),
      );
      const [latest, ...older] = entries;
      return {
        ...latest!,
        previousVersions: older.map((entry) => ({
          planId: entry.planId,
          artifactId: entry.artifact.id,
          ...(entry.artifact.sourceRunId
            ? { runId: entry.artifact.sourceRunId }
            : {}),
          ...(entry.artifact.sha256 ? { sha256: entry.artifact.sha256 } : {}),
        })),
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
