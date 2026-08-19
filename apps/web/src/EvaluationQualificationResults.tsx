import { copy } from "./copy";
import { formatDateTime, shortId } from "./evaluation-casebook-artifacts";
import type { useEvaluationCasebook } from "./use-evaluation-casebook";

type EvaluationCasebookState = ReturnType<typeof useEvaluationCasebook>;

export interface EvaluationQualificationResultsProps {
  state: EvaluationCasebookState;
}

export function EvaluationQualificationResults({
  state,
}: EvaluationQualificationResultsProps) {
  const { currentQualification, currentCases, qualificationHistory, selected } =
    state;
  if (!selected) return null;
  return (
    <>
      {currentQualification ? (
        <>
          <dl className="casebook-qualification-summary">
            <div>
              <dt>{copy.lab.casebook.qualification.agreement}</dt>
              <dd>{Math.round(currentQualification.agreementRate * 100)}%</dd>
            </div>
            <div>
              <dt>{copy.lab.casebook.qualification.verified}</dt>
              <dd>
                {currentQualification.sampleCount -
                  currentQualification.unverifiedCount}
                /{currentQualification.sampleCount}
              </dd>
            </div>
            <div>
              <dt>{copy.lab.casebook.qualification.inconclusive}</dt>
              <dd>{currentQualification.inconclusiveCount}</dd>
            </div>
            <div>
              <dt>{copy.lab.casebook.qualification.executionHash}</dt>
              <dd title={currentQualification.contentSha256}>
                {currentQualification.contentSha256.slice(0, 10)}
              </dd>
            </div>
          </dl>
          <ol className="casebook-qualification-cases">
            {currentQualification.results.map((result) => (
              <li
                key={result.caseId}
                className={`casebook-qualification-case-${result.status}`}
              >
                <header>
                  <span>
                    <strong>{shortId(result.sourceEvaluationId)}</strong>
                    <small>{shortId(result.sourceThreadId)}</small>
                  </span>
                  <strong>
                    {
                      copy.lab.casebook.qualification.caseStatuses[
                        result.status
                      ]
                    }
                  </strong>
                </header>
                <div>
                  <span>
                    {copy.lab.casebook.qualification.expected}
                    <strong>{copy.lab.verdicts[result.expectedVerdict]}</strong>
                  </span>
                  <span aria-hidden="true">→</span>
                  <span>
                    {copy.lab.casebook.qualification.actual}
                    <strong>{copy.lab.verdicts[result.actualVerdict]}</strong>
                  </span>
                </div>
                <details>
                  <summary>
                    <span>
                      {
                        copy.lab.casebook.qualification.evidenceStates[
                          result.evidenceState
                        ]
                      }
                    </span>
                    <code title={result.caseSha256}>
                      {result.caseSha256.slice(0, 10)}
                    </code>
                  </summary>
                  <p>{result.reason}</p>
                  <code title={result.expectedLeftSnapshotSha256}>
                    {copy.lab.casebook.qualification.expectedLeft}{" "}
                    {result.expectedLeftSnapshotSha256.slice(0, 10)}
                  </code>
                  <code title={result.observedLeftSnapshotSha256}>
                    {copy.lab.casebook.qualification.observedLeft}{" "}
                    {result.observedLeftSnapshotSha256?.slice(0, 10) ??
                      copy.lab.casebook.qualification.unavailable}
                  </code>
                  <code title={result.expectedRightSnapshotSha256}>
                    {copy.lab.casebook.qualification.expectedRight}{" "}
                    {result.expectedRightSnapshotSha256.slice(0, 10)}
                  </code>
                  <code title={result.observedRightSnapshotSha256}>
                    {copy.lab.casebook.qualification.observedRight}{" "}
                    {result.observedRightSnapshotSha256?.slice(0, 10) ??
                      copy.lab.casebook.qualification.unavailable}
                  </code>
                </details>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="casebook-qualification-empty">
          {currentCases.length
            ? copy.lab.casebook.qualification.empty
            : copy.lab.casebook.qualification.noCases}
        </p>
      )}

      {qualificationHistory.length ? (
        <details className="casebook-qualification-history">
          <summary>
            <span>{copy.lab.casebook.qualification.history}</span>
            <code>{qualificationHistory.length}</code>
          </summary>
          <ol>
            {qualificationHistory.slice(0, 8).map((execution) => (
              <li key={execution.id}>
                <span>
                  r{execution.casebookRevision} ·{" "}
                  {execution.evaluatorModel.provider}/
                  {execution.evaluatorModel.id}
                </span>
                <strong
                  className={`casebook-qualification-status casebook-qualification-status-${execution.status}`}
                >
                  {copy.lab.casebook.qualification.statuses[execution.status]}
                </strong>
                <code title={execution.contentSha256}>
                  {execution.contentSha256.slice(0, 10)}
                </code>
                <small>
                  {execution.casebookRevision === selected.currentRevision
                    ? copy.lab.casebook.qualification.current
                    : copy.lab.casebook.qualification.stale}
                </small>
                <time dateTime={execution.finishedAt}>
                  {formatDateTime(execution.finishedAt)}
                </time>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </>
  );
}
