import { ChevronRight } from "lucide-react";

import type { ExecutionPlan } from "@napier/contracts";

import { planCopy } from "./plan-copy";
import {
  projectReplanRecoveryNextAction,
  projectReplanRecordSummary,
  projectReplanRecoveryProgress,
} from "./replan-draft-view-model";

export interface PlanReplanRecordCardProps {
  plan: ExecutionPlan;
  running: boolean;
  readyStepId: string | undefined;
  onContinue: () => void;
}

export function PlanReplanRecordCard({
  plan,
  running,
  readyStepId,
  onContinue,
}: PlanReplanRecordCardProps) {
  const replan = plan.replans.at(-1);
  if (!replan) return null;
  const summary = projectReplanRecordSummary(replan);
  const recovery = projectReplanRecoveryProgress(plan, replan);
  const next = projectReplanRecoveryNextAction(recovery, {
    planStatus: plan.status,
    readyStepId,
    running,
  });
  return (
    <div className="plan-replan-ledger" aria-label={planCopy.replan}>
      <span>{planCopy.replan}</span>
      <strong>{planCopy.replanStrategies[replan.strategy]}</strong>
      <small>
        r{replan.fromRevision} {"->"} r{replan.toRevision} / {planCopy.hash}:{" "}
        {replan.replanSha256.slice(0, 12)}
      </small>
      <ReplanChangeSummary summary={summary} />
      {recovery?.hasRecoveryWork ? (
        <div className="plan-replan-recovery-progress">
          <span>{planCopy.recoveryProgress}</span>
          <strong>
            {recovery.isComplete
              ? planCopy.recoveryComplete
              : planCopy.recoveryInProgress}
          </strong>
          <small>
            {recovery.settledStepCount.toLocaleString()} /{" "}
            {recovery.addedStepCount.toLocaleString()}{" "}
            {planCopy.recoveryStepsSettled} /{" "}
            {recovery.verifiedArtifactCount.toLocaleString()} /{" "}
            {recovery.addedArtifactCount.toLocaleString()}{" "}
            {planCopy.recoveryArtifactsVerified}
          </small>
          <small>
            {planCopy.statuses.ready}: {recovery.readyStepCount} /{" "}
            {planCopy.statuses.running}: {recovery.runningStepCount} /{" "}
            {planCopy.statuses.blocked}: {recovery.blockedStepCount} /{" "}
            {planCopy.statuses.produced}: {recovery.producedArtifactCount} /{" "}
            {planCopy.statuses.expected}: {recovery.pendingArtifactCount} /{" "}
            {planCopy.statuses.missing}: {recovery.missingArtifactCount}
          </small>
          <small
            className={`plan-replan-recovery-next plan-replan-recovery-next--${next.action}`}
          >
            {planCopy.recoveryNextActions[next.action]}
          </small>
          {next.canRun ? (
            <button
              className="plan-review-action plan-apply-action"
              type="button"
              onClick={onContinue}
            >
              <ChevronRight size={12} aria-hidden="true" />
              {planCopy.runRecoveryStep}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type ReplanSummary = ReturnType<typeof projectReplanRecordSummary>;

function ReplanChangeSummary({ summary }: { summary: ReplanSummary }) {
  const rows = [
    [planCopy.supersededSteps, summary.supersededStepIds],
    [planCopy.supersededArtifacts, summary.supersededArtifactIds],
    [planCopy.addedSteps, summary.addedStepIds],
    [planCopy.addedArtifacts, summary.addedArtifactIds],
    [planCopy.dependencyUpdates, summary.dependencyUpdatedStepIds],
  ] as const;
  return (
    <div className="plan-replan-record-summary">
      <span>{planCopy.appliedChanges}</span>
      <strong>
        {summary.structuralChangeCount.toLocaleString()} {planCopy.changes} /{" "}
        {planCopy.hash}:{" "}
        <code title={summary.replanSha256}>
          {summary.replanSha256.slice(0, 12)}
        </code>
      </strong>
      <dl>
        {rows.map(([label, values]) =>
          values.length > 0 ? (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{values.join(", ")}</dd>
            </div>
          ) : null,
        )}
        <HashRow
          label={planCopy.addedStepsHash}
          value={summary.addedStepsSha256}
        />
        <HashRow
          label={planCopy.addedArtifactsHash}
          value={summary.addedArtifactsSha256}
        />
        <HashRow
          label={planCopy.dependencyUpdatesHash}
          value={summary.dependencyUpdatesSha256}
        />
      </dl>
    </div>
  );
}

function HashRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <code title={value}>{value.slice(0, 12)}</code>
      </dd>
    </div>
  );
}
