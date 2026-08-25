import { BadgeCheck, Clock3 } from "lucide-react";

import type { ThreadDetail } from "@napier/contracts";
import { copy } from "./copy";

type ValidationDetail = Pick<ThreadDetail, "plans" | "runs">;

export function TaskValidationPanel({
  detail,
}: {
  detail: ValidationDetail | undefined;
}) {
  const plan =
    detail?.plans.findLast(
      (candidate) =>
        candidate.status === "active" || candidate.status === "blocked",
    ) ?? detail?.plans.at(-1);
  const latestRun = detail?.runs.at(-1);
  const checks = plan?.steps.filter(
    (step) => step.verification || step.evidence,
  );

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

      {checks && checks.length > 0 ? (
        <section className="task-checks" aria-labelledby="task-checks-title">
          <h3 id="task-checks-title">{copy.taskView.validation.checks}</h3>
          <ol>
            {checks.map((step) => {
              const verified =
                step.status === "completed" && Boolean(step.evidence);
              return (
                <li key={step.id}>
                  <span
                    className={`task-status-badge ${verified ? "is-verified" : "is-pending"}`}
                  >
                    {verified
                      ? copy.taskView.validation.passed
                      : copy.taskView.validation.pending}
                  </span>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.verification}</p>
                    {step.evidence ? <small>{step.evidence}</small> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ) : latestRun ? null : (
        <p className="task-empty-state">{copy.taskView.validation.empty}</p>
      )}
    </section>
  );
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
