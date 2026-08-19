import { Circle, ShieldCheck, Target } from "lucide-react";

import type { GoalState } from "@napier/contracts";
import { copy } from "./copy";

export function GoalPanel({
  goal,
  draft,
  onDraft,
  onSave,
  onClear,
}: {
  goal?: GoalState;
  draft: string;
  onDraft: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
}) {
  return (
    <section className="panel-section" aria-labelledby="goal-title">
      <div className="panel-heading">
        <div>
          <span>{copy.goal.eyebrow}</span>
          <h2 id="goal-title">{copy.goal.title}</h2>
        </div>
        {goal ? (
          <span className={`goal-state goal-${goal.status}`}>
            {goalStatusLabel(goal.status)}
          </span>
        ) : null}
      </div>
      {goal ? (
        <div className={`goal-card goal-card-${goal.status}`}>
          <div className="goal-pin">
            <Target size={18} aria-hidden="true" />
          </div>
          <p>{goal.objective}</p>
          <dl>
            <div>
              <dt>{copy.goal.status}</dt>
              <dd>{copy.goal.blockers[goal.blocker]}</dd>
            </div>
            <div>
              <dt>{copy.goal.continuations}</dt>
              <dd>
                {goal.continuationCount} / {goal.maxContinuations}
              </dd>
            </div>
            {goal.noProgressCount > 0 ? (
              <div>
                <dt>{copy.goal.noProgress}</dt>
                <dd>
                  {goal.noProgressCount} / {goal.maxNoProgressContinuations}
                </dd>
              </div>
            ) : null}
          </dl>
          {goal.evidence ? (
            <div className="evidence-note">
              <span>{copy.goal.evidence}</span>
              <p>{goal.evidence}</p>
            </div>
          ) : null}
          <button
            className="text-button danger"
            type="button"
            onClick={onClear}
          >
            {copy.goal.clear}
          </button>
        </div>
      ) : (
        <div className="goal-empty">
          <div className="empty-orbit" aria-hidden="true">
            <Circle size={44} />
            <Target size={17} />
          </div>
          <p>{copy.goal.empty}</p>
          <textarea
            rows={5}
            value={draft}
            placeholder={copy.goal.placeholder}
            onChange={(event) => onDraft(event.target.value)}
          />
          <button
            className="primary-wide"
            type="button"
            disabled={!draft.trim()}
            onClick={onSave}
          >
            <Target size={14} aria-hidden="true" />
            {copy.goal.set}
          </button>
        </div>
      )}
      <p className="guardrail-note">
        <ShieldCheck size={13} aria-hidden="true" />
        {copy.goal.guardrail}
      </p>
    </section>
  );
}

export default GoalPanel;

function goalStatusLabel(status: GoalState["status"]): string {
  if (status === "completed") return copy.goal.completed;
  if (status === "blocked") return copy.goal.blocked;
  return copy.goal.active;
}
