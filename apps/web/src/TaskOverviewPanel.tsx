import { ArrowRight, Check, Circle, CircleHelp, Target } from "lucide-react";

import type { GoalState, OperatorDecision, ThreadDetail } from "@napier/contracts";
import { copy } from "./copy";

type OverviewDetail = Pick<
  ThreadDetail,
  "thread" | "plans" | "activePlan"
>;

export function TaskOverviewPanel({
  detail,
  goal,
  goalDraft,
  modelConfigured,
  decision,
  onGoalDraft,
  onGoalSave,
  onGoalClear,
  onContinue,
  onReviewDecision,
}: {
  detail: OverviewDetail | undefined;
  goal: GoalState | undefined;
  goalDraft: string;
  modelConfigured: boolean;
  decision: OperatorDecision | undefined;
  onGoalDraft(value: string): void;
  onGoalSave(): void;
  onGoalClear(): void;
  onContinue(): void;
  onReviewDecision(): void;
}) {
  const plan =
    detail?.plans.findLast(
      (candidate) =>
        candidate.status === "active" || candidate.status === "blocked",
    ) ?? detail?.plans.at(-1);
  const progress = detail?.activePlan;
  const objective =
    progress?.objective ?? plan?.objective ?? goal?.objective ?? detail?.thread.title;
  const currentStep =
    progress?.runningStep ?? progress?.blockedStep ?? progress?.nextStep;

  return (
    <section className="task-panel task-overview" aria-labelledby="task-overview-title">
      <header className="task-panel-heading">
        <div>
          <span>{copy.taskView.eyebrow}</span>
          <h2 id="task-overview-title">{copy.taskView.overview.title}</h2>
        </div>
        {progress?.nextStep && !decision ? (
          <button
            className="task-primary-action"
            type="button"
            disabled={!modelConfigured}
            title={modelConfigured ? undefined : copy.modelUnavailableHint}
            onClick={onContinue}
          >
            {copy.taskView.overview.continue}
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {decision ? (
        <section className="task-decision-blocker" aria-labelledby="task-decision-title">
          <CircleHelp size={18} aria-hidden="true" />
          <div>
            <span>{copy.taskView.overview.decisionEyebrow}</span>
            <h3 id="task-decision-title">{decision.header}</h3>
            <p>{decision.question}</p>
            <small>{copy.taskView.overview.decisionNext}</small>
          </div>
          <button className="task-primary-action" type="button" onClick={onReviewDecision}>
            {copy.taskView.overview.reviewDecision}
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </section>
      ) : null}

      <div className="task-overview-summary">
        <article className="task-objective-card">
          <span>{copy.taskView.overview.objective}</span>
          <strong>{objective || copy.taskView.overview.noPlan}</strong>
          {currentStep ? (
            <p>
              {copy.taskView.overview.current}: {currentStep.title}
            </p>
          ) : null}
        </article>
        <dl className="task-progress-stats">
          <div>
            <dt>{copy.taskView.overview.progress}</dt>
            <dd>
              {progress?.completedStepCount ?? 0}/{progress?.stepCount ?? 0}
            </dd>
          </div>
          <div>
            <dt>{copy.taskView.overview.artifacts}</dt>
            <dd>
              {(progress?.verifiedArtifactCount ?? 0) +
                (progress?.producedArtifactCount ?? 0)}
            </dd>
          </div>
        </dl>
      </div>

      {plan ? (
        <ol className="task-step-list" aria-label={copy.taskView.overview.progress}>
          {plan.steps.map((step) => (
            <li className={`is-${step.status}`} key={step.id}>
              <span aria-hidden="true">
                {step.status === "completed" ? (
                  <Check size={14} />
                ) : (
                  <Circle size={12} />
                )}
              </span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.description}</p>
              </div>
              <small>{copy.taskView.overview.stepStatus[step.status]}</small>
            </li>
          ))}
        </ol>
      ) : (
        <p className="task-empty-state">{copy.taskView.overview.noPlan}</p>
      )}

      <section className="task-goal" aria-label={copy.goal.title}>
        <header>
          <Target size={16} aria-hidden="true" />
          <strong>{copy.goal.title}</strong>
        </header>
        {goal ? (
          <div className="task-goal-current">
            <p>{goal.objective}</p>
            {goal.evidence ? <small>{goal.evidence}</small> : null}
            <button type="button" onClick={onGoalClear}>
              {copy.taskView.overview.clearGoal}
            </button>
          </div>
        ) : (
          <details>
            <summary>{copy.taskView.overview.addGoal}</summary>
            <p>{copy.taskView.overview.noGoal}</p>
            <textarea
              rows={3}
              value={goalDraft}
              placeholder={copy.goal.placeholder}
              onChange={(event) => onGoalDraft(event.currentTarget.value)}
            />
            <button
              className="task-primary-action"
              type="button"
              disabled={!goalDraft.trim()}
              onClick={onGoalSave}
            >
              {copy.taskView.overview.saveGoal}
            </button>
          </details>
        )}
      </section>
    </section>
  );
}
