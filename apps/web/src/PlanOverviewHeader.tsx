import type { ExecutionPlan } from "@napier/contracts";

import { planCopy } from "./plan-copy";

export interface PlanOverviewHeaderProps {
  plan: ExecutionPlan;
}

export function PlanOverviewHeader({ plan }: PlanOverviewHeaderProps) {
  const settled = plan.steps.filter(
    (step) => step.status === "completed" || step.status === "skipped",
  ).length;
  const activePhase = plan.phaseWaves.find(
    (wave) => wave.index === plan.activePhaseIndex,
  );
  const progress = (settled / Math.max(1, plan.steps.length)) * 100;
  return (
    <>
      <header>
        <div>
          <span>{planCopy.objective}</span>
          <h3>{plan.objective}</h3>
        </div>
        <span className="plan-status">{planCopy.statuses[plan.status]}</span>
      </header>
      <div className="plan-progress">
        <div>
          <span>{planCopy.progress}</span>
          <strong>
            {settled} / {plan.steps.length}
          </strong>
        </div>
        <span aria-hidden="true">
          <i style={{ width: `${progress}%` }} />
        </span>
      </div>
      <div className="plan-critical-path" aria-label={planCopy.criticalPath}>
        <span>{planCopy.criticalPath}</span>
        <strong>
          {plan.criticalPathStepIds.length > 0
            ? plan.criticalPathStepIds.join(" -> ")
            : planCopy.none}
        </strong>
        <small>
          {planCopy.readyPath}: {joinOrNone(plan.readyStepIds)} /{" "}
          {planCopy.blockedPath}: {joinOrNone(plan.blockedStepIds)}
        </small>
        <small>
          {planCopy.phase}:{" "}
          {activePhase
            ? `${activePhase.index + 1} / ${plan.phaseWaves.length}`
            : planCopy.none}
          {" / "}
          {planCopy.parallelReady}: {joinOrNone(plan.parallelReadyStepIds)}
          {" / "}
          {planCopy.phaseHash}:{" "}
          <code title={plan.phaseProjectionSha256}>
            {plan.phaseProjectionSha256.slice(0, 12)}
          </code>
        </small>
      </div>
    </>
  );
}

function joinOrNone(values: string[]): string {
  return values.length > 0 ? values.join(", ") : planCopy.none;
}
