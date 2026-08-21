import { useId, useState } from "react";
import { CheckCircle2, ChevronDown, FolderOpen } from "lucide-react";

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
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  if (completedItems.length === 0 && paths.length === 0) return null;
  const primaryResult =
    completedItems[0] ??
    (paths[0]
      ? `${taskSurfaceCopy.completion.output} · ${fileName(paths[0])}`
      : taskSurfaceCopy.completion.title);
  return (
    <div className="task-narrative-completed">
      <div className="task-completion-strip">
        <CheckCircle2 size={18} aria-hidden="true" />
        <div className="task-completion-copy">
          <span>
            {taskSurfaceCopy.completion.eyebrow} ·{" "}
            {taskSurfaceCopy.completion.title}
          </span>
          <strong title={primaryResult}>{primaryResult}</strong>
        </div>
        <span className="task-completion-counts">
          {completedItems.length > 0
            ? `${completedItems.length} ${taskSurfaceCopy.completion.items}`
            : null}
          {completedItems.length > 0 && paths.length > 0 ? " · " : null}
          {paths.length > 0
            ? `${paths.length} ${taskSurfaceCopy.completion.outputCount}`
            : null}
        </span>
        {paths[0] ? (
          <button
            className="task-completion-primary-output"
            type="button"
            title={`${taskSurfaceCopy.completion.open} ${paths[0]}`}
            onClick={() => onOpenArtifact(paths[0]!)}
          >
            <FolderOpen size={14} aria-hidden="true" />
            {fileName(paths[0])}
          </button>
        ) : null}
        <button
          className="task-completion-toggle"
          type="button"
          aria-controls={detailsId}
          aria-expanded={expanded}
          title={
            expanded
              ? taskSurfaceCopy.completion.hideDetails
              : taskSurfaceCopy.completion.showDetails
          }
          onClick={() => setExpanded((current) => !current)}
        >
          <span>
            {expanded
              ? taskSurfaceCopy.completion.hideDetails
              : taskSurfaceCopy.completion.showDetails}
          </span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
      {expanded ? (
        <div className="task-completion-details" id={detailsId}>
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
      ) : null}
    </div>
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
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
