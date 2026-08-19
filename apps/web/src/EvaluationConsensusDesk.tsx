import { X } from "lucide-react";

import type {
  EvaluationConsensusResolution,
  EvaluationReviewerBallot,
  RunEvaluationRecord,
} from "@napier/contracts";

import { copy } from "./copy";
import { EvaluationConsensusBallotForm } from "./EvaluationConsensusBallotForm";
import { EvaluationConsensusGate } from "./EvaluationConsensusGate";
import { EvaluationConsensusRoster } from "./EvaluationConsensusRoster";
import { useEvaluationConsensus } from "./use-evaluation-consensus";

export interface EvaluationConsensusDeskProps {
  threadId: string;
  evaluation: RunEvaluationRecord;
  ballots: EvaluationReviewerBallot[];
  resolutions: EvaluationConsensusResolution[];
  onRefresh(): Promise<void>;
  onClose(): void;
}

export function EvaluationConsensusDesk(props: EvaluationConsensusDeskProps) {
  const state = useEvaluationConsensus(props);
  const busy = Boolean(state.busyAction);
  return (
    <section
      className="consensus-desk"
      aria-labelledby={`consensus-desk-${props.evaluation.id}`}
    >
      <header>
        <div>
          <span>{copy.lab.calibration.consensus.eyebrow}</span>
          <h5 id={`consensus-desk-${props.evaluation.id}`}>
            {copy.lab.calibration.consensus.title}
          </h5>
        </div>
        <button type="button" disabled={busy} onClick={props.onClose}>
          <X size={10} aria-hidden="true" />
          {copy.lab.calibration.consensus.close}
        </button>
      </header>
      <p>{copy.lab.calibration.consensus.body}</p>
      <EvaluationConsensusRoster
        ballots={state.sortedBallots}
        disabled={busy}
        onEdit={state.editBallot}
      />
      <EvaluationConsensusBallotForm
        reviewerId={state.reviewerId}
        reviewerName={state.reviewerName}
        expectedVerdict={state.expectedVerdict}
        note={state.note}
        canSubmit={state.canSubmitBallot}
        busyAction={state.busyAction}
        onReviewerId={state.setReviewerId}
        onReviewerName={state.setReviewerName}
        onExpectedVerdict={state.setExpectedVerdict}
        onNote={state.setNote}
        onClear={state.resetBallot}
        onSubmit={() => void state.submitBallot()}
      />
      <EvaluationConsensusGate
        minimumReviewers={state.minimumReviewers}
        minimumAgreementRate={state.minimumAgreementRate}
        allowInconclusive={state.allowInconclusive}
        report={state.report}
        latestResolution={state.latestResolution}
        busyAction={state.busyAction}
        onMinimumReviewers={(value) => {
          state.setMinimumReviewers(value);
          state.invalidateReport();
        }}
        onMinimumAgreementRate={(value) => {
          state.setMinimumAgreementRate(value);
          state.invalidateReport();
        }}
        onAllowInconclusive={(value) => {
          state.setAllowInconclusive(value);
          state.invalidateReport();
        }}
        onPreview={() => void state.previewConsensus()}
        onResolve={() => void state.resolveConsensus()}
      />
      {state.error ? (
        <p className="suite-error" role="alert">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
