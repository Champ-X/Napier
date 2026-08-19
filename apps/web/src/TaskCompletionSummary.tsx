import { CheckCircle2, FolderOpen } from "lucide-react";

import type { ExecutionPlan } from "@napier/contracts";
import { taskSurfaceCopy } from "./task-surface-copy";

export interface TaskCompletionSummaryProps {
  completedItems: string[];
  plans: ExecutionPlan[];
  activePlan?:
    | Pick<
        NonNullable<import("@napier/contracts").ThreadDetail["activePlan"]>,
        "outputPaths"
      >
    | undefined;
  onOpenArtifact(path: string): void;
}

export default function TaskCompletionSummary({
  completedItems,
  plans,
  activePlan,
  onOpenArtifact,
}: TaskCompletionSummaryProps) {
  const paths = taskArtifactPaths(plans, activePlan);
  if (completedItems.length === 0 && paths.length === 0) return null;
  return (
    <div className="task-narrative-completed">
      <header>
        <CheckCircle2 size={18} aria-hidden="true" />
        <div>
          <span>{taskSurfaceCopy.completion.eyebrow}</span>
          <strong>{taskSurfaceCopy.completion.title}</strong>
        </div>
      </header>
      {completedItems.length > 0 ? (
        <ul>
          {completedItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {paths.length > 0 ? (
        <nav aria-label={taskSurfaceCopy.completion.outputs}>
          {paths.map((path) => (
            <button
              key={path}
              type="button"
              title={`${taskSurfaceCopy.completion.open} ${path}`}
              onClick={() => onOpenArtifact(path)}
            >
              <FolderOpen size={14} aria-hidden="true" />
              {taskSurfaceCopy.completion.output} · {path}
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

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
