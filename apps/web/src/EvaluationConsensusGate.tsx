import { Check, Play, ShieldCheck } from "lucide-react";

import type {
  EvaluationConsensusReport,
  EvaluationConsensusResolution,
} from "@napier/contracts";

import { copy } from "./copy";
import { CALIBRATION_VERDICTS } from "./evaluation-calibration-constants";
import { formatDateTime } from "./evaluation-suite-artifacts";

export interface EvaluationConsensusGateProps {
  minimumReviewers: number;
  minimumAgreementRate: number;
  allowInconclusive: boolean;
  report: EvaluationConsensusReport | undefined;
  latestResolution: EvaluationConsensusResolution | undefined;
  busyAction: string | undefined;
  onMinimumReviewers(value: number): void;
  onMinimumAgreementRate(value: number): void;
  onAllowInconclusive(value: boolean): void;
  onPreview(): void;
  onResolve(): void;
}

export function EvaluationConsensusGate(props: EvaluationConsensusGateProps) {
  const {
    minimumReviewers,
    minimumAgreementRate,
    allowInconclusive,
    report,
    latestResolution,
    busyAction,
  } = props;
  return (
    <>
      <fieldset className="consensus-gate">
        <legend>{copy.lab.calibration.consensus.gate}</legend>
        <label>
          <span>{copy.lab.calibration.consensus.minimumReviewers}</span>
          <select
            value={minimumReviewers}
            disabled={Boolean(busyAction)}
            onChange={(event) =>
              props.onMinimumReviewers(Number(event.currentTarget.value))
            }
          >
            {Array.from({ length: 8 }, (_, index) => index + 2).map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
        <label className="consensus-rate">
          <span>{copy.lab.calibration.consensus.minimumAgreement}</span>
          <output>{minimumAgreementRate}%</output>
          <input
            type="range"
            min={50}
            max={100}
            step={1}
            value={minimumAgreementRate}
            disabled={Boolean(busyAction)}
            onChange={(event) =>
              props.onMinimumAgreementRate(event.currentTarget.valueAsNumber)
            }
          />
        </label>
        <label className="consensus-inconclusive">
          <input
            type="checkbox"
            checked={allowInconclusive}
            disabled={Boolean(busyAction)}
            onChange={(event) =>
              props.onAllowInconclusive(event.target.checked)
            }
          />
          <span>{copy.lab.calibration.consensus.allowInconclusive}</span>
        </label>
      </fieldset>
      <div className="consensus-actions">
        <button
          type="button"
          disabled={Boolean(busyAction)}
          onClick={props.onPreview}
        >
          <Play size={10} aria-hidden="true" />
          {busyAction === "preview"
            ? copy.lab.calibration.consensus.previewing
            : copy.lab.calibration.consensus.preview}
        </button>
        <button
          className="consensus-resolve"
          type="button"
          disabled={report?.status !== "ready" || Boolean(busyAction)}
          onClick={props.onResolve}
        >
          <Check size={10} aria-hidden="true" />
          {busyAction === "resolve"
            ? copy.lab.calibration.consensus.resolving
            : copy.lab.calibration.consensus.resolve}
        </button>
      </div>
      <ConsensusReport report={report} />
      {latestResolution ? (
        <footer className="consensus-resolution">
          <span>{copy.lab.calibration.consensus.latestResolution}</span>
          <code title={latestResolution.contentSha256}>
            r{latestResolution.adjudicationRevision.revision} ·{" "}
            {latestResolution.contentSha256.slice(0, 10)}
          </code>
          <time dateTime={latestResolution.createdAt}>
            {formatDateTime(latestResolution.createdAt)}
          </time>
        </footer>
      ) : null}
      <p className="consensus-safety">
        <ShieldCheck size={10} aria-hidden="true" />
        {copy.lab.calibration.consensus.safety}
      </p>
    </>
  );
}

function ConsensusReport({
  report,
}: {
  report: EvaluationConsensusReport | undefined;
}) {
  if (!report)
    return (
      <p className="consensus-report-stale">
        {copy.lab.calibration.consensus.previewRequired}
      </p>
    );
  return (
    <div className="consensus-report" aria-live="polite">
      <header>
        <span>{copy.lab.calibration.consensus.statuses[report.status]}</span>
        <strong>
          {report.consensusVerdict
            ? copy.lab.verdicts[report.consensusVerdict]
            : copy.lab.calibration.consensus.noLeader}
        </strong>
        <code title={report.contentSha256}>
          {report.contentSha256.slice(0, 10)}
        </code>
      </header>
      <div className="consensus-distribution">
        {CALIBRATION_VERDICTS.map((verdict) => (
          <span key={verdict}>
            {copy.lab.calibration.verdictMarks[verdict]}
            <strong>{report.verdictCounts[verdict]}</strong>
          </span>
        ))}
      </div>
      <p>
        {report.consensusCount}/{report.reviewerCount} ·{" "}
        {Math.round(report.agreementRate * 100)}%{" "}
        {copy.lab.calibration.consensus.agreement}
      </p>
    </div>
  );
}
