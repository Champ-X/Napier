import { FolderOpen } from "lucide-react";

import type { ExecutionPlan } from "@napier/contracts";

export default function TaskCompletionSummary({
  completedItems,
  plans,
  onOpenArtifact,
}: {
  completedItems: string[];
  plans: ExecutionPlan[];
  onOpenArtifact(path: string): void;
}) {
  const paths = taskArtifactPaths(plans);
  if (completedItems.length === 0 && paths.length === 0) return null;
  return (
    <div className="task-narrative-completed">
      <span>Completed</span>
      {completedItems.length > 0 ? <p>{completedItems.join(" · ")}</p> : null}
      {paths.length > 0 ? (
        <nav aria-label="Task outputs">
          {paths.map((path) => (
            <button
              key={path}
              type="button"
              title={`Open ${path}`}
              onClick={() => onOpenArtifact(path)}
            >
              <FolderOpen size={9} aria-hidden="true" />
              Outputs · {path}
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

export function taskArtifactPaths(plans: readonly ExecutionPlan[]): string[] {
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
