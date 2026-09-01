import { useState } from "react";
import { AlertCircle, Check, Circle, LoaderCircle, Minus } from "lucide-react";
import type { PlanStepStatus, ThreadDetail } from "@napier/contracts";

import { conversationPlanProgress } from "./conversation-plan-progress";
import { taskSurfaceCopy } from "./task-surface-copy";

export function ConversationPlanProgress({
  detail,
  isRunning,
}: {
  detail: ThreadDetail | undefined;
  isRunning: boolean;
}) {
  const progress = conversationPlanProgress(detail, isRunning);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  if (!progress) return null;
  const expanded = hovered || focused || pinned;
  const popoverId = `plan-progress-${progress.planId}`;
  const label = `${taskSurfaceCopy.plan.progress.stepPrefix}${progress.currentStepNumber} / ${progress.stepCount}${taskSurfaceCopy.plan.progress.stepSuffix}`;
  const completion = Math.min(
    100,
    Math.max(0, (progress.settledStepCount / progress.stepCount) * 100),
  );

  return (
    <div
      className={`composer-plan-progress${expanded ? " is-expanded" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
          setPinned(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setPinned(false);
          setHovered(false);
          event.currentTarget
            .querySelector<HTMLButtonElement>("button")
            ?.focus();
        }
      }}
    >
      <button
        className="composer-plan-progress-capsule"
        type="button"
        aria-expanded={expanded}
        aria-controls={popoverId}
        aria-label={`${taskSurfaceCopy.plan.progress.ariaLabel}: ${label}`}
        onClick={() => setPinned((current) => !current)}
      >
        <svg
          className="composer-plan-progress-ring"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <circle className="track" cx="10" cy="10" r="7" />
          <circle
            className="meter"
            cx="10"
            cy="10"
            r="7"
            pathLength="100"
            strokeDasharray={`${completion} 100`}
          />
        </svg>
        <span aria-live="polite">{label}</span>
      </button>
      {expanded ? (
        <section
          id={popoverId}
          className="composer-plan-progress-popover"
          aria-label={taskSurfaceCopy.plan.progress.ariaLabel}
        >
          <header>
            <div>
              <span>{taskSurfaceCopy.plan.progress.eyebrow}</span>
              <strong>{progress.objective}</strong>
            </div>
            <small>
              {progress.settledStepCount}/{progress.stepCount}{" "}
              {taskSurfaceCopy.plan.settled}
            </small>
          </header>
          <ol>
            {progress.steps.map((step, index) => (
              <li
                className={`${step.current ? "is-current " : ""}status-${step.status}`}
                key={step.id}
              >
                <span className="composer-plan-step-icon">
                  {progressStepIcon(step.status)}
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <small>
                    {index + 1}. {taskSurfaceCopy.plan.statuses[step.status]}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function progressStepIcon(status: PlanStepStatus) {
  if (status === "completed") return <Check size={12} aria-hidden="true" />;
  if (status === "running") {
    return (
      <LoaderCircle className="is-spinning" size={13} aria-hidden="true" />
    );
  }
  if (status === "blocked") {
    return <AlertCircle size={13} aria-hidden="true" />;
  }
  if (status === "skipped") return <Minus size={12} aria-hidden="true" />;
  return <Circle size={12} aria-hidden="true" />;
}
