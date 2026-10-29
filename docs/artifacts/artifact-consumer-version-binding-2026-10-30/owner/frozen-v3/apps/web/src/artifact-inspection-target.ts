import type { ThreadDetail } from "@napier/contracts";
import type { ArtifactInspection } from "./artifact-inspection";
import { taskArtifactTargets } from "./task-completion-output-paths";

type ArtifactTargetDetail = Pick<
  ThreadDetail,
  "thread" | "plans" | "activePlan" | "taskNarrative"
>;

export function artifactInspectionForPath(
  detail: ArtifactTargetDetail | undefined,
  workspaceRoot: string,
  path: string,
): ArtifactInspection | undefined {
  if (!detail) return undefined;
  const target = taskArtifactTargetForPath(detail, workspaceRoot, path);
  if (!target?.artifact || !target.planId) return undefined;
  return {
    artifact: target.artifact,
    mode: "preview",
    planId: target.planId,
    ...(target.planRevision !== undefined
      ? { planRevision: target.planRevision }
      : {}),
    threadId: detail.thread.id,
  };
}

export function taskArtifactTargetForPath(
  detail: ArtifactTargetDetail | undefined,
  workspaceRoot: string,
  path: string,
) {
  return detail
    ? taskArtifactTargets(
        detail.plans,
        detail.activePlan,
        detail.taskNarrative?.deliverables,
      ).find(
        (candidate) =>
          absoluteWorkspacePath(workspaceRoot, candidate.path) ===
          absoluteWorkspacePath(workspaceRoot, path),
      )
    : undefined;
}

function absoluteWorkspacePath(
  workspaceRoot: string,
  filePath: string,
): string {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized)) {
    return filePath;
  }
  const separator = workspaceRoot.includes("\\") ? "\\" : "/";
  return `${workspaceRoot.replace(/[\\/]$/u, "")}${separator}${filePath}`;
}
