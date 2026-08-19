import { Plus, RefreshCw, Trash2, X } from "lucide-react";

import { copy } from "./copy";
import { shortId } from "./evaluation-casebook-artifacts";
import type { useEvaluationCasebook } from "./use-evaluation-casebook";

type EvaluationCasebookState = ReturnType<typeof useEvaluationCasebook>;

export interface EvaluationCasebookCurationProps {
  state: EvaluationCasebookState;
}

export function EvaluationCasebookCuration({
  state,
}: EvaluationCasebookCurationProps) {
  const {
    reviewedEvaluations,
    curationEvaluationId,
    setCurationEvaluationId,
    adjudicationByEvaluation,
    selectedEvaluation,
    curationState,
    busyId,
    currentCases,
    pendingRemoveId,
    setPendingRemoveId,
    curate,
    remove,
  } = state;
  return (
    <>
      <section
        className="casebook-curation"
        aria-labelledby="casebook-curation-title"
      >
        <header>
          <span id="casebook-curation-title">{copy.lab.casebook.curate}</span>
          <code>{reviewedEvaluations.length}</code>
        </header>
        {reviewedEvaluations.length === 0 ? (
          <p>{copy.lab.casebook.noReviewed}</p>
        ) : (
          <div>
            <select
              aria-label={copy.lab.casebook.curate}
              value={curationEvaluationId}
              disabled={Boolean(busyId)}
              onChange={(event) => setCurationEvaluationId(event.target.value)}
            >
              {reviewedEvaluations.map((evaluation) => {
                const truth = adjudicationByEvaluation
                  .get(evaluation.id)
                  ?.revisions.at(-1);
                return (
                  <option key={evaluation.id} value={evaluation.id}>
                    {shortId(evaluation.id)} ·{" "}
                    {copy.lab.verdicts[evaluation.verdict]} →{" "}
                    {truth ? copy.lab.verdicts[truth.expectedVerdict] : "–"}
                  </option>
                );
              })}
            </select>
            <button
              className="casebook-primary"
              type="button"
              disabled={
                !selectedEvaluation ||
                curationState === "current" ||
                Boolean(busyId)
              }
              onClick={() => void curate()}
            >
              {curationState === "refresh" ? (
                <RefreshCw size={11} aria-hidden="true" />
              ) : (
                <Plus size={11} aria-hidden="true" />
              )}
              {busyId?.startsWith("curate:")
                ? copy.lab.casebook.curating
                : curationState === "current"
                  ? copy.lab.casebook.upToDate
                  : curationState === "refresh"
                    ? copy.lab.casebook.refreshAction
                    : copy.lab.casebook.curateAction}
            </button>
          </div>
        )}
      </section>

      <ol className="casebook-case-list">
        {currentCases.map((item) => (
          <li key={item.id}>
            <header>
              <span>
                <strong>{shortId(item.sourceEvaluationId)}</strong>
                <small>
                  {copy.lab.casebook.source} {shortId(item.sourceThreadId)}
                </small>
              </span>
              <code>
                {copy.lab.casebook.truthRevision}{" "}
                {item.adjudicationRevision.revision}
                {item.adjudicationRevision.source === "reviewer_consensus"
                  ? ` · ${copy.lab.calibration.consensus.provenance}`
                  : ""}
              </code>
            </header>
            <div className="casebook-verdicts">
              <span>
                {copy.lab.casebook.modelVerdict}
                <strong>{copy.lab.verdicts[item.evaluation.verdict]}</strong>
              </span>
              <span>
                {copy.lab.casebook.expectedVerdict}
                <strong>
                  {copy.lab.verdicts[item.adjudicationRevision.expectedVerdict]}
                </strong>
              </span>
            </div>
            <div className="casebook-hashes">
              <code title={item.contentSha256}>
                {copy.lab.casebook.caseHash} {item.contentSha256.slice(0, 12)}
              </code>
              <code title={item.adjudicationRevision.evaluationSha256}>
                {copy.lab.casebook.evaluationHash}{" "}
                {item.adjudicationRevision.evaluationSha256.slice(0, 12)}
              </code>
              {item.consensusResolution ? (
                <code title={item.consensusResolution.contentSha256}>
                  {copy.lab.casebook.consensusEvidence}{" "}
                  {item.consensusResolution.report.reviewerCount} ·{" "}
                  {item.consensusResolution.contentSha256.slice(0, 12)}
                </code>
              ) : null}
            </div>
            {pendingRemoveId === item.id ? (
              <footer className="casebook-remove-confirm">
                <button
                  type="button"
                  disabled={Boolean(busyId)}
                  onClick={() => setPendingRemoveId(undefined)}
                >
                  <X size={10} aria-hidden="true" />
                  {copy.lab.casebook.cancel}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busyId)}
                  onClick={() => void remove(item)}
                >
                  <Trash2 size={10} aria-hidden="true" />
                  {busyId === `remove:${item.id}`
                    ? copy.lab.casebook.removing
                    : copy.lab.casebook.confirmRemove}
                </button>
              </footer>
            ) : (
              <button
                className="casebook-remove"
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => setPendingRemoveId(item.id)}
              >
                <Trash2 size={10} aria-hidden="true" />
                {copy.lab.casebook.remove}
              </button>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}
