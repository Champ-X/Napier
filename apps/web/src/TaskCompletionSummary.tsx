import { useId, useState } from "react";
import { CheckCircle2, ChevronDown, FolderOpen } from "lucide-react";

import { ArtifactActionSurface } from "./ArtifactActionSurface";
import { artifactActionAvailability } from "./artifact-action-model";
import { taskSurfaceCopy } from "./task-surface-copy";
import { taskArtifactTargets } from "./task-completion-output-paths";

export interface TaskCompletionSummaryProps {
  completedItems: string[];
  plans: Parameters<typeof taskArtifactTargets>[0];
  activePlan?: Parameters<typeof taskArtifactTargets>[1];
  threadId?: string;
  onLedgerChanged?(): void | Promise<void>;
  onOpenArtifact(path: string): void;
}

export default function TaskCompletionSummary({
  completedItems,
  plans,
  activePlan,
  threadId,
  onLedgerChanged,
  onOpenArtifact,
}: TaskCompletionSummaryProps) {
  const targets = taskArtifactTargets(plans, activePlan);
  const paths = targets.map((target) => target.path);
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
        {targets[0] ? (
          <PrimaryArtifactAction
            target={targets[0]}
            {...(threadId ? { threadId } : {})}
            {...(onLedgerChanged ? { onLedgerChanged } : {})}
            onOpenArtifact={onOpenArtifact}
          />
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
              <div
                className="task-completion-outputs"
                role="group"
                aria-label={taskSurfaceCopy.completion.outputs}
              >
                {targets.map((target) => (
                  <div className="task-completion-output" key={target.path}>
                    <code title={target.path}>{fileName(target.path)}</code>
                    {target.artifact && target.planId && threadId ? (
                      <ArtifactActionSurface
                        artifact={target.artifact}
                        planId={target.planId}
                        threadId={threadId}
                        {...(onLedgerChanged ? { onLedgerChanged } : {})}
                      />
                    ) : (
                      <LegacyOpenAction
                        path={target.path}
                        onOpenArtifact={onOpenArtifact}
                      />
                    )}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PrimaryArtifactAction({
  target,
  threadId,
  onLedgerChanged,
  onOpenArtifact,
}: {
  target: ReturnType<typeof taskArtifactTargets>[number];
  threadId?: string;
  onLedgerChanged?(): void | Promise<void>;
  onOpenArtifact(path: string): void;
}) {
  const directlyOpenable =
    target.artifact &&
    artifactActionAvailability(target.artifact).actions.includes("open");
  return directlyOpenable && target.planId && threadId ? (
    <div
      className="task-completion-primary-output"
      title={`${taskSurfaceCopy.completion.open} ${target.path}`}
    >
      <code>{fileName(target.path)}</code>
      <ArtifactActionSurface
        artifact={target.artifact!}
        planId={target.planId}
        threadId={threadId}
        onOpen={() => onOpenArtifact(target.path)}
        {...(onLedgerChanged ? { onLedgerChanged } : {})}
        displayActions={["open"]}
      />
    </div>
  ) : (
    <LegacyOpenAction
      path={target.path}
      onOpenArtifact={onOpenArtifact}
      primary
    />
  );
}

function LegacyOpenAction({
  path,
  onOpenArtifact,
  primary = false,
}: {
  path: string;
  onOpenArtifact(path: string): void;
  primary?: boolean;
}) {
  return (
    <button
      className={primary ? "task-completion-primary-output" : undefined}
      type="button"
      title={`${taskSurfaceCopy.completion.open} ${path}`}
      onClick={() => onOpenArtifact(path)}
    >
      <FolderOpen size={14} aria-hidden="true" />
      <span className="task-completion-output-label">{fileName(path)}</span>
    </button>
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}
