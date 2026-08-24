import { lazy, Suspense, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Globe2,
  Square,
} from "lucide-react";

import type { ThreadDetail } from "@napier/contracts";
import { copy } from "./copy";
import { EnvironmentDegradationNotice } from "./EnvironmentDegradationNotice";
import { taskNarrative } from "./task-narrative-view-model";
import { shellCopy } from "./shell-copy";

const LazyTaskCompletionSummary = lazy(() => import("./TaskCompletionSummary"));

export interface TaskNarrativeBarProps {
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
}

// Shared CSS owns the intrinsic desktop layout and complete control states.
export function TaskNarrativeBar({
  detail,
  browserControlsAvailable,
  onOpenArtifact,
  onOpenBrowserControls,
  onStop,
}: TaskNarrativeBarProps) {
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
      aria-label={shellCopy.taskNarrative.status}
    >
      <div className="task-status-bar" aria-live="polite">
        <div className="task-narrative-current">
          <span>
            <Icon size={16} aria-hidden="true" />
            {narrative.phaseLabel}
          </span>
          <strong title={narrative.currentAction}>
            {narrative.currentAction}
          </strong>
        </div>
        {narrative.currentAction ||
        narrative.elapsed ||
        narrative.metrics ||
        narrative.blocker ||
        narrative.nextStep ||
        narrative.harness ? (
          <details className="task-status-details">
            <summary aria-label={copy.narrative.details}>
              {copy.narrative.details}
              <ChevronDown size={14} aria-hidden="true" />
            </summary>
            <div className="task-status-details-popover">
              <section className="task-narrative-action-detail">
                <span>{copy.narrative.currentAction}</span>
                <p>{narrative.currentAction}</p>
              </section>
              {narrative.elapsed ? (
                <section>
                  <span>{copy.narrative.elapsed}</span>
                  <p>{narrative.elapsed}</p>
                </section>
              ) : null}
              {narrative.blocker ? (
                <section className="task-narrative-blocker">
                  <span>{copy.narrative.blockedBy}</span>
                  <p>{narrative.blocker}</p>
                </section>
              ) : null}
              {narrative.nextStep ? (
                <section className="task-narrative-next">
                  <span>{copy.narrative.next}</span>
                  <p>{narrative.nextStep}</p>
                </section>
              ) : null}
              {narrative.metrics ? (
                <section>
                  <span>{copy.narrative.runMetrics}</span>
                  <p>{narrative.metrics}</p>
                </section>
              ) : null}
              {narrative.harness ? (
                <section className="task-narrative-harness">
                  <span>{copy.narrative.harness}</span>
                  <p>
                    {harnessFamily(narrative.harness.family)} ·{" "}
                    {narrative.harness.toolSurface === "focused"
                      ? copy.narrative.harnessFocused
                      : copy.narrative.harnessFull}{" "}
                    · {narrative.harness.activeToolCount} /{" "}
                    {narrative.harness.configuredToolCount}{" "}
                    {copy.narrative.harnessTools}
                  </p>
                </section>
              ) : null}
              <EnvironmentDegradationNotice detail={detail} />
            </div>
          </details>
        ) : null}
        {running || browserControlsAvailable ? (
          <div
            className="task-narrative-actions"
            aria-label={shellCopy.taskNarrative.controls}
          >
            {browserControlsAvailable ? (
              <button type="button" onClick={onOpenBrowserControls}>
                <Globe2 size={14} aria-hidden="true" />
                {copy.narrative.browserControls}
              </button>
            ) : null}
            {running ? (
              <button className="is-stop" type="button" onClick={onStop}>
                <Square size={11} fill="currentColor" aria-hidden="true" />
                {copy.narrative.stop}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {narrative.phase === "completed" ? (
        <div className="task-result-summary">
          <Suspense fallback={null}>
            <LazyTaskCompletionSummary
              completedItems={narrative.completedItems}
              plans={detail?.plans ?? []}
              activePlan={detail?.activePlan}
              onOpenArtifact={onOpenArtifact}
            />
          </Suspense>
        </div>
      ) : null}
    </section>
  );
}

export default TaskNarrativeBar;

function harnessFamily(
  family: "anthropic" | "openai" | "google" | "generic",
): string {
  return family === "openai"
    ? "OpenAI"
    : family === "anthropic"
      ? "Anthropic"
      : family === "google"
        ? "Google"
        : shellCopy.taskNarrative.genericHarness;
}
