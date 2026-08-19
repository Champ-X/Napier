import type { ExecutionPlan } from "@napier/contracts";

import { planCopy } from "./plan-copy";
import { projectReplanStepRoles } from "./replan-draft-view-model";

export interface PlanStepListProps {
  plan: ExecutionPlan;
}

export function PlanStepList({ plan }: PlanStepListProps) {
  const criticalPath = new Set(plan.criticalPathStepIds);
  const latestReplan = plan.replans.at(-1);
  return (
    <ol className="plan-steps">
      {plan.steps.map((step, index) => {
        const roles = projectReplanStepRoles(step.id, latestReplan);
        return (
          <li
            className={`plan-step step-${step.status}${
              criticalPath.has(step.id) ? " on-critical-path" : ""
            }`}
            key={step.id}
          >
            <div className="step-index">
              {String(index + 1).padStart(2, "0")}
            </div>
            <div className="step-body">
              <header>
                <h4>{step.title}</h4>
                <div className="plan-entity-status">
                  <span className="plan-status-badge">
                    {planCopy.statuses[step.status]}
                  </span>
                  {roles.length > 0 ? (
                    <div
                      className="plan-replan-entity-badges"
                      aria-label={planCopy.latestReplanImpact}
                    >
                      {roles.map((role) => (
                        <span key={role}>
                          {planCopy.replanEntityRoles[role]}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </header>
              <p>{step.description}</p>
              <dl>
                <PlanStepDetail
                  label={planCopy.dependsOn}
                  value={
                    step.dependsOn.length > 0
                      ? step.dependsOn.join(", ")
                      : planCopy.none
                  }
                />
                <PlanStepDetail
                  label={planCopy.verification}
                  value={step.verification}
                />
                {step.evidence ? (
                  <PlanStepDetail
                    label={planCopy.evidence}
                    value={step.evidence}
                  />
                ) : null}
                {step.blocker ? (
                  <PlanStepDetail
                    label={planCopy.blocker}
                    value={step.blocker}
                  />
                ) : null}
              </dl>
              {step.runId ? <code>{step.runId}</code> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function PlanStepDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
