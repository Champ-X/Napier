import { Pencil, Save, Users, X } from "lucide-react";

import type {
  RunEvaluationRecord,
  RunEvaluationVerdict,
} from "@napier/contracts";

import { copy } from "./copy";
import { EvaluationConsensusDesk } from "./EvaluationConsensusDesk";
import { CALIBRATION_VERDICTS } from "./evaluation-calibration-constants";
import { shortId } from "./evaluation-suite-artifacts";
import type { useEvaluationCalibration } from "./use-evaluation-calibration";

type CalibrationState = ReturnType<typeof useEvaluationCalibration>;

export interface EvaluationCalibrationRegisterProps {
  state: CalibrationState;
}

export function EvaluationCalibrationRegister({
  state,
}: EvaluationCalibrationRegisterProps) {
  return (
    <details
      className="calibration-register"
      open={state.registerOpen}
      onToggle={(event) => state.setRegisterOpen(event.currentTarget.open)}
    >
      <summary>
        <span>
          <strong>{copy.lab.calibration.register}</strong>
          <small>{copy.lab.calibration.registerHint}</small>
        </span>
        <code>
          {state.reviewedCount}/{state.evaluations.length}
        </code>
      </summary>
      {state.reviewRegister.length === 0 ? (
        <p className="calibration-empty">{copy.lab.calibration.empty}</p>
      ) : (
        <ol>
          {state.reviewRegister.map((evaluation) => (
            <CalibrationReviewItem
              key={evaluation.id}
              state={state}
              evaluation={evaluation}
            />
          ))}
        </ol>
      )}
    </details>
  );
}

function CalibrationReviewItem({
  state,
  evaluation,
}: {
  state: CalibrationState;
  evaluation: RunEvaluationRecord;
}) {
  const adjudication = state.adjudicationByEvaluation.get(evaluation.id);
  const truth = adjudication?.revisions.at(-1);
  const reviewing = state.reviewingEvaluationId === evaluation.id;
  const panelReviewing = state.panelEvaluationId === evaluation.id;
  const ballots = state.reviewerBallots.filter(
    (ballot) => ballot.evaluationId === evaluation.id,
  );
  const resolutions = state.consensusResolutions.filter(
    (resolution) => resolution.evaluationId === evaluation.id,
  );
  return (
    <li>
      <header>
        <span>
          <strong>
            {shortId(evaluation.leftRunId)} → {shortId(evaluation.rightRunId)}
          </strong>
          <small>
            {evaluation.evaluatorModel.provider}/{evaluation.evaluatorModel.id}
          </small>
        </span>
        <span
          className={`calibration-state ${truth ? (truth.expectedVerdict === evaluation.verdict ? "is-agreed" : "is-diverged") : ""}`}
        >
          {truth
            ? truth.expectedVerdict === evaluation.verdict
              ? copy.lab.calibration.agreed
              : copy.lab.calibration.disagreed
            : copy.lab.calibration.unreviewed}
        </span>
      </header>
      <div className="calibration-verdict-pair">
        <span>
          {copy.lab.calibration.modelVerdict}
          <strong>{copy.lab.verdicts[evaluation.verdict]}</strong>
        </span>
        <span>
          {copy.lab.calibration.expectedVerdict}
          <strong>
            {truth ? copy.lab.verdicts[truth.expectedVerdict] : "–"}
          </strong>
        </span>
        <code title={truth?.contentSha256}>
          {truth
            ? `${copy.lab.calibration.revision} ${truth.revision} · ${truth.contentSha256.slice(0, 10)}${truth.source === "reviewer_consensus" ? ` · ${copy.lab.calibration.consensus.provenance}` : ""}`
            : evaluation.id}
        </code>
      </div>
      {reviewing ? (
        <CalibrationReviewForm state={state} />
      ) : panelReviewing ? (
        <EvaluationConsensusDesk
          threadId={state.threadId}
          evaluation={evaluation}
          ballots={ballots}
          resolutions={resolutions}
          onRefresh={state.onRefresh}
          onClose={state.closePanelReview}
        />
      ) : (
        <div className="calibration-review-actions">
          <button
            className="calibration-review-action"
            type="button"
            disabled={state.busy}
            aria-expanded={false}
            onClick={() => state.beginPanelReview(evaluation.id)}
          >
            <Users size={11} aria-hidden="true" />
            {copy.lab.calibration.consensus.open}
            {ballots.length ? <code>{ballots.length}</code> : null}
          </button>
          <button
            className="calibration-review-action"
            type="button"
            disabled={state.busy}
            aria-expanded={false}
            onClick={() => state.beginReview(evaluation)}
          >
            <Pencil size={11} aria-hidden="true" />
            {truth ? copy.lab.calibration.revise : copy.lab.calibration.review}
          </button>
        </div>
      )}
    </li>
  );
}

function CalibrationReviewForm({ state }: { state: CalibrationState }) {
  return (
    <div className="calibration-review-form">
      <label>
        <span>{copy.lab.calibration.expectedVerdict}</span>
        <select
          value={state.expectedVerdict}
          onChange={(event) =>
            state.setExpectedVerdict(event.target.value as RunEvaluationVerdict)
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
        <span>{copy.lab.calibration.note}</span>
        <textarea
          rows={3}
          maxLength={1_000}
          value={state.note}
          placeholder={copy.lab.calibration.notePlaceholder}
          onChange={(event) => state.setNote(event.target.value)}
        />
      </label>
      <footer>
        <button
          type="button"
          disabled={state.busy}
          onClick={state.cancelReview}
        >
          <X size={11} aria-hidden="true" />
          {copy.lab.calibration.cancel}
        </button>
        <button
          className="calibration-save"
          type="button"
          disabled={state.busy}
          onClick={() => void state.submitReview()}
        >
          <Save size={11} aria-hidden="true" />
          {state.busy ? copy.lab.calibration.saving : copy.lab.calibration.save}
        </button>
      </footer>
    </div>
  );
}
