import { Save, X } from "lucide-react";

import type { RunEvaluationVerdict } from "@napier/contracts";

import { copy } from "./copy";
import { CALIBRATION_VERDICTS } from "./evaluation-calibration-constants";

export interface EvaluationConsensusBallotFormProps {
  reviewerId: string;
  reviewerName: string;
  expectedVerdict: RunEvaluationVerdict;
  note: string;
  canSubmit: boolean;
  busyAction: string | undefined;
  onReviewerId(value: string): void;
  onReviewerName(value: string): void;
  onExpectedVerdict(value: RunEvaluationVerdict): void;
  onNote(value: string): void;
  onClear(): void;
  onSubmit(): void;
}

export function EvaluationConsensusBallotForm(
  props: EvaluationConsensusBallotFormProps,
) {
  const {
    reviewerId,
    reviewerName,
    expectedVerdict,
    note,
    canSubmit,
    busyAction,
  } = props;
  return (
    <div className="consensus-ballot-form">
      <div>
        <label>
          <span>{copy.lab.calibration.consensus.reviewerId}</span>
          <input
            type="text"
            maxLength={64}
            value={reviewerId}
            placeholder={copy.lab.calibration.consensus.reviewerIdPlaceholder}
            onChange={(event) => props.onReviewerId(event.target.value)}
          />
        </label>
        <label>
          <span>{copy.lab.calibration.consensus.reviewerName}</span>
          <input
            type="text"
            maxLength={80}
            value={reviewerName}
            placeholder={copy.lab.calibration.consensus.reviewerNamePlaceholder}
            onChange={(event) => props.onReviewerName(event.target.value)}
          />
        </label>
      </div>
      <label>
        <span>{copy.lab.calibration.expectedVerdict}</span>
        <select
          value={expectedVerdict}
          onChange={(event) =>
            props.onExpectedVerdict(event.target.value as RunEvaluationVerdict)
          }
        >
          {CALIBRATION_VERDICTS.map((verdict) => (
            <option key={verdict} value={verdict}>
              {copy.lab.verdicts[verdict]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{copy.lab.calibration.consensus.ballotNote}</span>
        <textarea
          rows={2}
          maxLength={1_000}
          value={note}
          placeholder={copy.lab.calibration.consensus.ballotNotePlaceholder}
          onChange={(event) => props.onNote(event.target.value)}
        />
      </label>
      <footer>
        {reviewerId ? (
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={props.onClear}
          >
            <X size={10} aria-hidden="true" />
            {copy.lab.calibration.consensus.clear}
          </button>
        ) : null}
        <button
          className="consensus-record"
          type="button"
          disabled={!canSubmit}
          onClick={props.onSubmit}
        >
          <Save size={10} aria-hidden="true" />
          {busyAction === "ballot"
            ? copy.lab.calibration.consensus.recording
            : copy.lab.calibration.consensus.record}
        </button>
      </footer>
    </div>
  );
}
