import { lazy, Suspense, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDot, Clock3 } from "lucide-react";

import type { ThreadDetail } from "@napier/contracts";
import { taskNarrative } from "./task-narrative-view-model";

const LazyTaskCompletionSummary = lazy(() => import("./TaskCompletionSummary"));

export function TaskNarrativeBar({
  detail,
}: {
  detail: Pick<
    ThreadDetail,
    | "thread"
    | "runs"
    | "plans"
    | "events"
    | "operatorDecisions"
    | "automaticRecoveryAssessments"
    | "automaticRecoveryAttempts"
  > | undefined;
}) {
  const [now, setNow] = useState(() => Date.now());
  const running = detail?.runs.some(
    (run) =>
      run.id === detail.thread.currentRunId && run.status === "running",
  );
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);
  const narrative = taskNarrative(detail, now);
  const Icon =
    narrative.phase === "completed"
      ? CheckCircle2
      : narrative.phase === "blocked" || narrative.phase === "failed"
        ? AlertTriangle
        : narrative.phase === "waiting"
          ? Clock3
          : CircleDot;

  return (
    <section
      className={`task-narrative phase-${narrative.phase}`}
      aria-label="Task status"
      aria-live="polite"
    >
      <div className="task-narrative-current">
        <span>
          <Icon size={14} aria-hidden="true" />
          {narrative.phaseLabel}
        </span>
        <strong>{narrative.currentAction}</strong>
        {narrative.metrics ? <small>{narrative.metrics}</small> : null}
      </div>
      <Suspense fallback={null}>
        <LazyTaskCompletionSummary
          completedItems={narrative.completedItems}
          plans={detail?.plans ?? []}
        />
      </Suspense>
      {narrative.blocker ? (
        <div className="task-narrative-blocker">
          <span>Blocked by</span>
          <p>{narrative.blocker}</p>
        </div>
      ) : narrative.nextStep ? (
        <div className="task-narrative-next">
          <span>Next</span>
          <p>{narrative.nextStep}</p>
        </div>
      ) : null}
    </section>
  );
}

export default TaskNarrativeBar;
