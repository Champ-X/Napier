import { lazy, Suspense, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock3,
  Globe2,
  Square,
} from "lucide-react";

import type { ThreadDetail } from "@napier/contracts";
import { taskNarrative } from "./task-narrative-view-model";

const LazyTaskCompletionSummary = lazy(() => import("./TaskCompletionSummary"));
const LazyDefaultProductTrialRecorder = lazy(
  () => import("./DefaultProductTrialRecorder"),
);

export function TaskNarrativeBar({
  detail,
  browserControlsAvailable,
  onOpenArtifact,
  onOpenBrowserControls,
  onStop,
}: {
  detail:
    | Pick<
        ThreadDetail,
        | "thread"
        | "runs"
        | "plans"
        | "events"
        | "operatorDecisions"
        | "automaticRecoveryAssessments"
        | "automaticRecoveryAttempts"
        | "activePlan"
      >
    | undefined;
  browserControlsAvailable: boolean;
  onOpenArtifact(path: string): void;
  onOpenBrowserControls(): void;
  onStop(): void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const running = detail?.runs.some(
    (run) => run.id === detail.thread.currentRunId && run.status === "running",
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
          activePlan={detail?.activePlan}
          onOpenArtifact={onOpenArtifact}
        />
      </Suspense>
      {narrative.blocker ? (
        <div className="task-narrative-blocker">
          <span>Blocked by</span>
          <p>{narrative.blocker}</p>
        </div>
      ) : null}
      {narrative.nextStep ? (
        <div className="task-narrative-next">
          <span>Next</span>
          <p>{narrative.nextStep}</p>
        </div>
      ) : null}
      {running || browserControlsAvailable ? (
        <div className="task-narrative-actions" aria-label="Task controls">
          {browserControlsAvailable ? (
            <button type="button" onClick={onOpenBrowserControls}>
              <Globe2 size={12} aria-hidden="true" />
              Browser controls
            </button>
          ) : null}
          {running ? (
            <button className="is-stop" type="button" onClick={onStop}>
              <Square size={10} fill="currentColor" aria-hidden="true" />
              Stop
            </button>
          ) : null}
        </div>
      ) : null}
      {detail ? (
        <Suspense fallback={null}>
          <LazyDefaultProductTrialRecorder
            threadId={detail.thread.id}
            runs={detail.runs}
          />
        </Suspense>
      ) : null}
    </section>
  );
}

export default TaskNarrativeBar;
