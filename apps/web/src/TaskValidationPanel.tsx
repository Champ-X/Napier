import { BadgeCheck, Clock3 } from "lucide-react";

import type { ThreadDetail } from "@napier/contracts";
import { copy } from "./copy";
import {
  taskValidationMatrix,
  type TaskValidationMatrixRow,
} from "./task-validation-matrix";

type ValidationDetail = Pick<ThreadDetail, "events" | "plans" | "runs">;

export function TaskValidationPanel({
  detail,
}: {
  detail: ValidationDetail | undefined;
}) {
  const latestRun = detail?.runs.at(-1);
  const rows = taskValidationMatrix(detail?.events ?? [], detail?.plans ?? []);

  return (
    <section
      className="task-panel task-validation"
      aria-labelledby="task-validation-title"
    >
      <header className="task-panel-heading">
        <div>
          <span>{copy.taskView.sections.validation}</span>
          <h2 id="task-validation-title">{copy.taskView.validation.title}</h2>
          <p>{copy.taskView.validation.body}</p>
        </div>
      </header>

      {latestRun ? (
        <article className="task-latest-run">
          <BadgeCheck size={18} aria-hidden="true" />
          <div>
            <span>{copy.taskView.validation.latestRun}</span>
            <strong>{taskStatusLabel(latestRun.status)}</strong>
          </div>
          <time>
            <Clock3 size={14} aria-hidden="true" />
            {runDuration(latestRun.startedAt, latestRun.finishedAt)}
          </time>
        </article>
      ) : null}

      <section className="task-checks" aria-labelledby="task-checks-title">
        <h3 id="task-checks-title">{copy.taskView.validation.checks}</h3>
        <div className="task-validation-matrix" role="table">
          <div className="task-validation-matrix-head" role="row">
            <span role="columnheader">{copy.taskView.validation.checks}</span>
            <span role="columnheader">{copy.taskView.validation.evidence}</span>
            <span role="columnheader">{copy.taskView.validation.source}</span>
          </div>
          {rows.map((row) => (
            <div className="task-validation-row" role="row" key={row.id}>
              <div role="cell">
                <span className={`task-status-badge is-${row.status}`}>
                  {copy.taskView.validation[row.status]}
                </span>
                <strong>{copy.taskView.validation.checksByKind[row.id]}</strong>
              </div>
              <p role="cell">{validationEvidence(row)}</p>
              <span role="cell" className="task-validation-source">
                {copy.taskView.validation.sources[row.source]}
                {row.eventSeq !== undefined ? ` · #${row.eventSeq}` : ""}
              </span>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function validationEvidence(row: TaskValidationMatrixRow): string {
  const text = copy.taskView.validation;
  if (row.status === "unknown") return text.noEvidence;
  if (row.id === "artifact") {
    return text.artifactCounts
      .replace("{verified}", String(row.verifiedArtifactCount ?? 0))
      .replace("{produced}", String(row.producedArtifactCount ?? 0))
      .replace("{missing}", String(row.missingArtifactCount ?? 0))
      .replace("{total}", String(row.artifactCount ?? 0));
  }
  const parts = [
    ...(row.diagnosticCount !== undefined
      ? [`${text.diagnostics} ${row.diagnosticCount}`]
      : []),
    ...(row.errorCount !== undefined ? [`${text.errors} ${row.errorCount}`] : []),
    ...(row.warningCount !== undefined
      ? [`${text.warnings} ${row.warningCount}`]
      : []),
    ...(row.exitCode !== undefined ? [`${text.exitCode} ${row.exitCode}`] : []),
    ...(row.durationMs !== undefined
      ? [`${text.duration} ${formatDuration(row.durationMs)}`]
      : []),
    ...(row.stale ? [text.stale] : []),
  ];
  return parts.join(" · ") || text.noEvidence;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs} ms`;
  return `${(durationMs / 1_000).toFixed(1)} s`;
}

function runDuration(startedAt: string, finishedAt: string | undefined) {
  const duration = Math.max(
    0,
    (finishedAt ? Date.parse(finishedAt) : Date.now()) - Date.parse(startedAt),
  );
  const seconds = Math.floor(duration / 1_000);
  if (seconds < 60) return seconds + copy.taskView.duration.second;
  return (
    Math.floor(seconds / 60) +
    copy.taskView.duration.minute +
    " " +
    (seconds % 60) +
    copy.taskView.duration.second
  );
}

function taskStatusLabel(status: string): string {
  return (
    (copy.taskView.status as Record<string, string>)[status] ??
    status.replaceAll("_", " ")
  );
}
