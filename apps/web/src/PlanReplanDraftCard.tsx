import { Brain, ChevronRight } from "lucide-react";

import type { ExecutionPlan } from "@napier/contracts";

import { planCopy } from "./plan-copy";
import { projectReplanDraftSummary } from "./replan-draft-view-model";
import type { PlanReplanController } from "./use-plan-replan-controller";

export interface PlanReplanDraftCardProps {
  plan: ExecutionPlan;
  running: boolean;
  selectedModelConfigured: boolean;
  controller: PlanReplanController;
}

export function PlanReplanDraftCard({
  plan,
  running,
  selectedModelConfigured,
  controller,
}: PlanReplanDraftCardProps) {
  const recommendation = plan.replanRecommendation;
  if (!recommendation) return null;
  const summary = projectReplanDraftSummary(recommendation);
  return (
    <div
      className="plan-replan-ledger plan-replan-signal"
      aria-label={planCopy.replanSignal}
    >
      <span>{planCopy.replanSignal}</span>
      <strong>{planCopy.replanStrategies[recommendation.strategy]}</strong>
      <small>
        r{recommendation.expectedRevision} / {planCopy.hash}:{" "}
        {recommendation.recommendationSha256.slice(0, 12)} / {planCopy.draft}:{" "}
        {recommendation.draft.draftSha256.slice(0, 12)} / {planCopy.score}:{" "}
        {recommendation.draft.evaluation.score} / {planCopy.risk}:{" "}
        {planCopy.replanRisks[recommendation.draft.evaluation.risk]}
      </small>
      <DraftChangeSummary summary={summary} />
      <button
        className="plan-review-action"
        type="button"
        disabled={
          controller.reviewBusy ||
          controller.applyBusy ||
          !selectedModelConfigured
        }
        aria-busy={controller.reviewBusy}
        aria-describedby={
          !selectedModelConfigured ? "plan-replan-model-unavailable" : undefined
        }
        onClick={() => void controller.onReview()}
      >
        <Brain size={12} aria-hidden="true" />
        {controller.reviewBusy ? planCopy.reviewingDraft : planCopy.reviewDraft}
      </button>
      <button
        className="plan-review-action plan-apply-action"
        type="button"
        disabled={controller.reviewBusy || controller.applyBusy || running}
        aria-busy={controller.applyBusy}
        onClick={() => void controller.onApply()}
      >
        <ChevronRight size={12} aria-hidden="true" />
        {controller.applyBusy ? planCopy.applyingDraft : planCopy.applyDraft}
      </button>
      {!selectedModelConfigured ? (
        <p
          id="plan-replan-model-unavailable"
          className="plan-review-error"
          role="status"
        >
          {planCopy.modelUnavailableHint}
        </p>
      ) : null}
      {controller.review ? <PlanDraftReview controller={controller} /> : null}
      {controller.error ? (
        <p className="plan-review-error" role="alert">
          {controller.error}
        </p>
      ) : null}
    </div>
  );
}

type DraftSummary = ReturnType<typeof projectReplanDraftSummary>;

function DraftChangeSummary({ summary }: { summary: DraftSummary }) {
  const rows = [
    [planCopy.supersededSteps, summary.supersededStepIds.join(", ")],
    [planCopy.supersededArtifacts, summary.supersededArtifactIds.join(", ")],
    [
      planCopy.addedSteps,
      summary.addedSteps
        .map((step) =>
          step.dependsOn.length > 0
            ? `${step.id}: ${step.title} (${step.dependsOn.join(", ")})`
            : `${step.id}: ${step.title}`,
        )
        .join(", "),
    ],
    [
      planCopy.addedArtifacts,
      summary.addedArtifacts
        .map(
          (artifact) => `${artifact.id} (${artifact.kind}: ${artifact.path})`,
        )
        .join(", "),
    ],
    [
      planCopy.dependencyUpdates,
      summary.dependencyUpdates
        .map(
          (update) =>
            `${update.stepId} -> ${
              update.dependsOn.length > 0
                ? update.dependsOn.join(", ")
                : planCopy.none
            }`,
        )
        .join(" / "),
    ],
  ] as const;
  return (
    <div className="plan-replan-draft-summary">
      <span>{planCopy.draftChanges}</span>
      <strong>
        {summary.structuralChangeCount.toLocaleString()} {planCopy.changes} /{" "}
        {planCopy.expectedRevision} r{summary.expectedRevision}
      </strong>
      <dl>
        {rows.map(([label, value]) =>
          value ? (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ) : null,
        )}
      </dl>
    </div>
  );
}

function PlanDraftReview({ controller }: { controller: PlanReplanController }) {
  const review = controller.review!;
  return (
    <div className="plan-replan-review">
      <span>{planCopy.modelReview}</span>
      <strong>
        {planCopy.reviewVerdicts[review.verdict]} / {planCopy.score}{" "}
        {review.score} / {planCopy.risk} {planCopy.replanRisks[review.risk]}
      </strong>
      <small className="plan-review-hashes">
        {review.modelContextEnvelope ? (
          <span>
            {planCopy.envelope}:{" "}
            <code title={review.modelContextEnvelope.contentSha256}>
              {review.modelContextEnvelope.contentSha256.slice(0, 12)}
            </code>
          </span>
        ) : null}
        <span>
          {planCopy.receipt}:{" "}
          <code title={review.reviewSha256}>
            {review.reviewSha256.slice(0, 12)}
          </code>
        </span>
        <span>
          {planCopy.response}:{" "}
          <code title={review.responseSha256}>
            {review.responseSha256.slice(0, 12)}
          </code>
        </span>
      </small>
      <p>{review.reason}</p>
      {review.concerns.length > 0 ? (
        <ul>
          {review.concerns.map((concern) => (
            <li key={concern}>{concern}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
