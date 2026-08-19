import type { ExecutionPlan } from "@napier/contracts";

import { planCopy } from "./plan-copy";
import { projectReplanHistorySummary } from "./replan-draft-view-model";

export interface PlanReplanHistoryProps {
  plan: ExecutionPlan;
}

export function PlanReplanHistory({ plan }: PlanReplanHistoryProps) {
  if (plan.replans.length < 2) return null;
  const summary = projectReplanHistorySummary(plan.replans);
  return (
    <div
      className="plan-replan-ledger plan-replan-history"
      aria-label={planCopy.replanHistory}
    >
      <span>{planCopy.replanHistory}</span>
      <strong>
        {summary.recordCount.toLocaleString()} {planCopy.records} /{" "}
        {summary.totalStructuralChangeCount.toLocaleString()} {planCopy.changes}
      </strong>
      <ol>
        {summary.records.map((record, index) => (
          <li key={record.id}>
            <span>
              #{String(index + 1).padStart(2, "0")}{" "}
              {planCopy.replanStrategies[record.strategy]}
            </span>
            <small>
              r{record.fromRevision} {"->"} r{record.toRevision} /{" "}
              {record.structuralChangeCount.toLocaleString()} {planCopy.changes}
              {" / "}
              {planCopy.hash}:{" "}
              <code title={record.replanSha256}>
                {record.replanSha256.slice(0, 12)}
              </code>
            </small>
          </li>
        ))}
      </ol>
    </div>
  );
}
