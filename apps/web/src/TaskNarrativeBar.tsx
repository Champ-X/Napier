import { AlertTriangle, CheckCircle2, CircleDot, Clock3 } from "lucide-react";

import type { ThreadDetail } from "@napier/contracts";
import { taskNarrative } from "./task-narrative-view-model";

export function TaskNarrativeBar({
  detail,
}: {
  detail: Pick<
    ThreadDetail,
    "thread" | "runs" | "plans" | "events" | "operatorDecisions"
  > | undefined;
}) {
  const narrative = taskNarrative(detail);
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
      </div>
      {narrative.completedItems.length > 0 ? (
        <div className="task-narrative-completed">
          <span>Completed</span>
          <p>{narrative.completedItems.join(" · ")}</p>
        </div>
      ) : null}
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
