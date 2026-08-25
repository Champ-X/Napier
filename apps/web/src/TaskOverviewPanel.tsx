import {
  ArrowRight,
  Check,
  Circle,
  CircleHelp,
  Target,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import type {
  ExecutionPlanStatus,
  GoalState,
  OperatorDecision,
  PlanStepStatus,
  ThreadDetail,
} from "@napier/contracts";
import { copy } from "./copy";
import {
  deriveTaskOverview,
  type TaskOverviewStep,
} from "./task-overview-view-model";
import { DisclosureRow } from "./ui/primitives/DisclosureRow";

type OverviewDetail = Pick<ThreadDetail, "thread" | "plans" | "activePlan">;

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
  const model = deriveTaskOverview(detail, goal);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  const overview = copy.taskView.overview;

  return (
    <section
      className="task-panel task-overview"
      aria-labelledby="task-overview-objective"
    >
      <header className="task-overview-lede">
        <span className="task-overview-eyebrow">{overview.objective}</span>
        <h2 id="task-overview-objective">
          {model.hasObjective ? model.objective : overview.noPlan}
        </h2>
        {model.hasPlan ? (
          <p className="task-overview-progress">
            <span>
              {model.completedStepCount} / {model.stepCount} {overview.complete}
            </span>
            {model.status ? (
              <span className={`task-overview-status is-${model.status}`}>
                {planStatusLabel(model.status)}
              </span>
            ) : null}
            {model.artifactCount > 0 ? (
              <span>
                {model.artifactCount} {overview.artifacts}
              </span>
            ) : null}
          </p>
        ) : null}
      </header>

      {decision ? (
        <section
          className="task-decision-blocker"
          aria-labelledby="task-decision-title"
        >
          <CircleHelp size={18} aria-hidden="true" />
          <div>
            <span>{overview.decisionEyebrow}</span>
            <h3 id="task-decision-title">{decision.header}</h3>
            <p>{decision.question}</p>
            <small>{overview.decisionNext}</small>
          </div>
          <button
            className="task-primary-action"
            type="button"
            onClick={onReviewDecision}
          >
            {overview.reviewDecision}
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </section>
      ) : null}

      {model.currentStep ? (
        <CurrentStep
          step={model.currentStep}
          canContinue={model.canContinue && !decision}
          modelConfigured={modelConfigured}
          onContinue={onContinue}
        />
      ) : null}

      {model.completedSteps.length > 0 ? (
        <DisclosureRow
          id="task-completed-steps"
          title={overview.completedSteps}
          status="success"
          meta={model.completedSteps.length}
          open={completedOpen}
          onToggle={setCompletedOpen}
        >
          <StepHistoryList steps={model.completedSteps} tone="completed" />
        </DisclosureRow>
      ) : null}

      {model.upcomingSteps.length > 0 ? (
        <DisclosureRow
          id="task-upcoming-steps"
          title={overview.upcomingSteps}
          meta={model.upcomingSteps.length}
          open={upcomingOpen}
          onToggle={setUpcomingOpen}
        >
          <StepHistoryList steps={model.upcomingSteps} tone="upcoming" />
        </DisclosureRow>
      ) : null}

      {model.hasPlan ? null : (
        <p className="task-empty-state">{overview.noPlan}</p>
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
              {overview.clearGoal}
            </button>
          </div>
        ) : (
          <details>
            <summary>{overview.addGoal}</summary>
            <p>{overview.noGoal}</p>
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
              {overview.saveGoal}
            </button>
          </details>
        )}
      </section>
    </section>
  );
}

function CurrentStep({
  step,
  canContinue,
  modelConfigured,
  onContinue,
}: {
  step: TaskOverviewStep;
  canContinue: boolean;
  modelConfigured: boolean;
  onContinue(): void;
}) {
  const overview = copy.taskView.overview;
  return (
    <section
      className={`task-current-step status-${stepTone(step.status)}`}
      aria-label={overview.current}
    >
      <header>
        <span className="task-current-step-label">{overview.current}</span>
        <span className="task-current-step-status">
          {stepStatusLabel(step.status)}
        </span>
      </header>
      <strong>{step.title}</strong>
      {step.description ? <p>{step.description}</p> : null}
      {step.blocker ? (
        <p className="task-current-step-blocker">
          <TriangleAlert size={15} aria-hidden="true" />
          {step.blocker}
        </p>
      ) : null}
      {canContinue ? (
        <button
          className="task-primary-action"
          type="button"
          disabled={!modelConfigured}
          title={modelConfigured ? undefined : copy.modelUnavailableHint}
          onClick={onContinue}
        >
          {overview.continue}
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}

function StepHistoryList({
  steps,
  tone,
}: {
  steps: TaskOverviewStep[];
  tone: "completed" | "upcoming";
}) {
  return (
    <ol className="task-step-history">
      {steps.map((step) => (
        <li className={`is-${tone}`} key={step.id}>
          <span aria-hidden="true">
            {tone === "completed" ? <Check size={13} /> : <Circle size={11} />}
          </span>
          <span>{step.title}</span>
          <small>{stepStatusLabel(step.status)}</small>
        </li>
      ))}
    </ol>
  );
}

function planStatusLabel(status: ExecutionPlanStatus): string {
  return (
    (copy.taskView.overview.planStatus as Record<string, string>)[status] ??
    status
  );
}

function stepStatusLabel(status: PlanStepStatus): string {
  return (
    (copy.taskView.status as Record<string, string>)[status] ??
    status.replaceAll("_", " ")
  );
}

function stepTone(status: PlanStepStatus): "running" | "danger" | "neutral" {
  if (status === "blocked") return "danger";
  if (status === "running" || status === "ready") return "running";
  return "neutral";
}
