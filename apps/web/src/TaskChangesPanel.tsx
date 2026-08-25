import { ArchiveRestore, FileText, Link2 } from "lucide-react";
import { lazy, Suspense } from "react";

import type { ThreadDetail } from "@napier/contracts";
import { copy } from "./copy";

const LazyFilesPanel = lazy(() => import("./FilesPanel"));

type ChangesDetail = Pick<
  ThreadDetail,
  "thread" | "plans" | "artifacts" | "citations"
>;

export function TaskChangesPanel({
  detail,
}: {
  detail: ChangesDetail | undefined;
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
          {artifacts.map((artifact) => (
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
                {taskStatusLabel(artifact.status)}
              </span>
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
        <details className="task-recovery-disclosure">
          <summary>
            <ArchiveRestore size={15} aria-hidden="true" />
            <span>
              <strong>{copy.taskView.changes.recovery}</strong>
              <small>{copy.taskView.changes.recoveryBody}</small>
            </span>
          </summary>
          <Suspense
            fallback={<div className="context-loading" role="status" />}
          >
            <LazyFilesPanel threadId={detail.thread.id} />
          </Suspense>
        </details>
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

function taskArtifacts(detail: ChangesDetail | undefined) {
  if (!detail) return [];
  const projected = (detail.artifacts ?? [])
    .filter((entry) => entry.attemptScope === "current")
    .map((entry) => entry.artifact);
  const plan =
    detail.plans.findLast(
      (candidate) =>
        candidate.status === "active" || candidate.status === "blocked",
    ) ?? detail.plans.at(-1);
  const candidates = projected.length > 0 ? projected : (plan?.artifacts ?? []);
  const unique = new Map(
    candidates.map((artifact) => [artifact.path, artifact]),
  );
  return [...unique.values()].filter(
    (artifact) => artifact.status !== "superseded",
  );
}
