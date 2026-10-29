import { FileText, Link2 } from "lucide-react";
import { lazy, Suspense } from "react";

import { projectTaskDeliverables } from "@napier/contracts/task-narrative";
import type { ThreadDetail } from "@napier/contracts";
import { ArtifactActionSurface } from "./ArtifactActionSurface";
import { copy } from "./copy";
import { artifactSelectionCurrentFact } from "./artifact-version-binding";
import { conversationDetailCopy } from "./conversation-detail-copy";

const LazyFilesPanel = lazy(() => import("./FilesPanel"));

type ChangesDetail = Pick<
  ThreadDetail,
  "thread" | "plans" | "artifacts" | "citations" | "taskNarrative"
>;

export function TaskChangesPanel({
  detail,
  onLedgerChanged,
}: {
  detail: ChangesDetail | undefined;
  onLedgerChanged?(): void | Promise<void>;
}) {
  const artifacts = taskArtifacts(detail);
  const citations = detail?.citations ?? [];
  return (
    <section
      className="task-panel task-changes"
      aria-labelledby="task-changes-title"
    >
      <header className="task-panel-heading">
        <div>
          <span>{copy.taskView.sections.changes}</span>
          <h2 id="task-changes-title">{copy.taskView.changes.title}</h2>
          <p>{copy.taskView.changes.body}</p>
        </div>
      </header>

      {artifacts.length > 0 ? (
        <div className="task-artifact-grid">
          {artifacts.map(({ artifact, planId, planRevision }) => (
            <article
              className={`task-artifact-card is-${artifact.status}`}
              data-artifact-path={artifact.path}
              key={`${artifact.id}:${artifact.path}`}
              tabIndex={-1}
            >
              <FileText size={17} aria-hidden="true" />
              <div>
                <strong>{artifact.path}</strong>
                <p>{artifact.description}</p>
              </div>
              <span className={`task-status-badge is-${artifact.status}`}>
                {artifactStatusLabel(
                  { artifact, planId, planRevision },
                  detail?.taskNarrative?.deliverables,
                )}
              </span>
              <ArtifactActionSurface
                artifact={artifact}
                planId={planId}
                planRevision={planRevision}
                threadId={detail!.thread.id}
                {...(onLedgerChanged ? { onLedgerChanged } : {})}
              />
            </article>
          ))}
        </div>
      ) : (
        <p className="task-empty-state">{copy.taskView.changes.empty}</p>
      )}

      {citations.length > 0 ? (
        <section
          className="task-reference-list"
          aria-labelledby="task-references-title"
        >
          <h3 id="task-references-title">
            <Link2 size={15} aria-hidden="true" />
            {copy.taskView.changes.references}
          </h3>
          <ul>
            {citations.map((citation) => (
              <li key={citation.id}>
                <strong>{citation.sourceId}</strong>
                <span>
                  {citation.sourceKind} · L{citation.startLine}–
                  {citation.endLine}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {detail ? (
        <Suspense fallback={<div className="context-loading" role="status" />}>
          <LazyFilesPanel threadId={detail.thread.id} />
        </Suspense>
      ) : null}
    </section>
  );
}

function taskStatusLabel(status: string): string {
  return (
    (copy.taskView.status as Record<string, string>)[status] ??
    status.replaceAll("_", " ")
  );
}

function artifactStatusLabel(
  selection: Parameters<typeof artifactSelectionCurrentFact>[0],
  deliverables: Parameters<typeof artifactSelectionCurrentFact>[1],
): string {
  const fact = artifactSelectionCurrentFact(selection, deliverables);
  const copy = conversationDetailCopy.artifact;
  return fact === "unchecked"
    ? selection.artifact.status === "verified"
      ? copy.statuses.verified
      : taskStatusLabel(selection.artifact.status)
    : copy.currentFacts[fact];
}

function taskArtifacts(detail: ChangesDetail | undefined) {
  if (!detail) return [];
  return projectTaskDeliverables(detail.plans).flatMap((entry) =>
    entry.planId &&
    entry.planRevision !== undefined &&
    entry.artifact.status !== "superseded"
      ? [
          {
            artifact: entry.artifact,
            planId: entry.planId,
            planRevision: entry.planRevision,
          },
        ]
      : [],
  );
}
