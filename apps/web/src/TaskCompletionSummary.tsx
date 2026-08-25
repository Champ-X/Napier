import { useId, useState } from "react";
import { CheckCircle2, ChevronDown, FolderOpen } from "lucide-react";

import { taskSurfaceCopy } from "./task-surface-copy";
import { taskArtifactPaths } from "./task-completion-output-paths";

export interface TaskCompletionSummaryProps {
  completedItems: string[];
  plans: Parameters<typeof taskArtifactPaths>[0];
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
            <span className="task-completion-output-label">
              {fileName(paths[0])}
            </span>
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
            <section className="task-completion-section">
              <span className="task-completion-section-label">
                {taskSurfaceCopy.completion.completedLabel}
              </span>
              <ul>
                {completedItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {paths.length > 0 ? (
            <section className="task-completion-section">
              <span className="task-completion-section-label">
                {taskSurfaceCopy.completion.outputsLabel}
              </span>
              <nav aria-label={taskSurfaceCopy.completion.outputs}>
                {paths.map((path) => (
                  <button
                    key={path}
                    type="button"
                    title={`${taskSurfaceCopy.completion.open} ${path}`}
                    onClick={() => onOpenArtifact(path)}
                  >
                    <FolderOpen size={14} aria-hidden="true" />
                    <span className="task-completion-output-label">
                      {fileName(path)}
                    </span>
                  </button>
                ))}
              </nav>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}
