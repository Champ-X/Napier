import { ShieldCheck } from "lucide-react";

import type {
  EvaluationAdjudication,
  EvaluationConsensusResolution,
  EvaluationReviewerBallot,
  RunEvaluationRecord,
} from "@napier/contracts";

import { copy } from "./copy";
import { EvaluationCalibrationCohorts } from "./EvaluationCalibrationCohorts";
import { EvaluationCalibrationRegister } from "./EvaluationCalibrationRegister";
import { useEvaluationCalibration } from "./use-evaluation-calibration";

export interface EvaluationCalibrationLedgerProps {
  threadId: string;
  evaluations: RunEvaluationRecord[];
  adjudications: EvaluationAdjudication[];
  reviewerBallots: EvaluationReviewerBallot[];
  consensusResolutions: EvaluationConsensusResolution[];
  onRefresh(): Promise<void>;
}

export function EvaluationCalibrationLedger(
  props: EvaluationCalibrationLedgerProps,
) {
  const state = useEvaluationCalibration(props);
  return (
    <section
      className="calibration-ledger"
      aria-labelledby="calibration-ledger-title"
    >
      <header>
        <div>
          <span>{copy.lab.calibration.eyebrow}</span>
          <h4 id="calibration-ledger-title">{copy.lab.calibration.title}</h4>
        </div>
        <ShieldCheck size={15} aria-hidden="true" />
      </header>
      <p>{copy.lab.calibration.body}</p>
      <div className="calibration-metrics" aria-live="polite">
        <div>
          <span>{copy.lab.calibration.reviewed}</span>
          <strong>
            {state.reviewedCount}/{props.evaluations.length}
          </strong>
          <progress
            value={state.reviewedCount}
            max={Math.max(props.evaluations.length, 1)}
            aria-label={copy.lab.calibration.reviewed}
          />
        </div>
        <div>
          <span>{copy.lab.calibration.agreement}</span>
          <strong>
            {state.agreementRate === undefined
              ? "–"
              : `${state.agreementRate}%`}
          </strong>
          <small>
            {state.report?.agreementCount ?? 0}/{state.report?.sampleCount ?? 0}
          </small>
        </div>
        <div>
          <span>{copy.lab.calibration.groups}</span>
          <strong>{state.report?.groups.length ?? 0}</strong>
          <small>{copy.lab.calibration.samples}</small>
        </div>
      </div>
      <EvaluationCalibrationCohorts report={state.report} />
      <EvaluationCalibrationRegister state={state} />
      {state.error ? (
        <p className="suite-error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.report ? (
        <code
          className="calibration-report-hash"
          title={state.report.contentSha256}
        >
          {copy.lab.calibration.reportHash}{" "}
          {state.report.contentSha256.slice(0, 12)}
        </code>
      ) : null}
      <p className="calibration-safety">
        <ShieldCheck size={11} aria-hidden="true" />
        {copy.lab.calibration.safety}
      </p>
    </section>
  );
}
