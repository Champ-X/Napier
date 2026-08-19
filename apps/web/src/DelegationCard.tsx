import { Layers } from "lucide-react";

import type { ModelRef, SubagentTask } from "@napier/contracts";

import { copy } from "./copy";
import { DelegationEvidenceCheck } from "./DelegationEvidenceCheck";

export interface DelegationCardProps {
  task: SubagentTask;
  reviewerModel: ModelRef | undefined;
  reviewerModelConfigured: boolean;
}

export function DelegationCard({
  task,
  reviewerModel,
  reviewerModelConfigured,
}: DelegationCardProps) {
  const summary =
    task.error ?? task.outcome?.summary ?? task.result ?? task.prompt;
  const summaryLabel = task.error
    ? copy.delegation.error
    : task.outcome
      ? copy.delegation.outcome
      : task.result
        ? copy.delegation.result
        : copy.delegation.prompt;

  return (
    <article className={`delegation-card delegation-${task.status}`}>
      <header>
        <span className="delegation-role">
          <Layers size={11} aria-hidden="true" />
          {task.role}
        </span>
        <span className="delegation-state">
          {delegationStatusLabel(task.status)}
        </span>
      </header>
      <h4>{task.description}</h4>
      <div className="delegation-result">
        <span>{summaryLabel}</span>
        <p>{summary}</p>
      </div>
      {task.outcome ? (
        <DelegationEvidenceCheck
          task={task}
          reviewerModel={reviewerModel}
          reviewerModelConfigured={reviewerModelConfigured}
        />
      ) : null}
      <footer>
        <dl>
          <div>
            <dt>{copy.delegation.turns}</dt>
            <dd>{task.turnCount}</dd>
          </div>
          <div>
            <dt>{copy.delegation.steps}</dt>
            <dd>{task.stepCount}</dd>
          </div>
          {task.outcome ? (
            <>
              <div>
                <dt>{copy.delegation.items}</dt>
                <dd>{task.outcome.itemCount}</dd>
              </div>
              <div>
                <dt>{copy.delegation.evidence}</dt>
                <dd>{task.outcome.evidenceCount ?? 0}</dd>
              </div>
              <div>
                <dt>{copy.delegation.unknowns}</dt>
                <dd>{task.outcome.unknownCount}</dd>
              </div>
            </>
          ) : null}
        </dl>
        <code title={task.outcome?.contentSha256}>
          {task.model.provider}/{task.model.id}
          {task.outcome
            ? ` · ${copy.delegation.receipt} ${task.outcome.contentSha256.slice(0, 10)}`
            : ""}
        </code>
      </footer>
    </article>
  );
}

function delegationStatusLabel(status: SubagentTask["status"]): string {
  return copy.delegation.statuses[status];
}
