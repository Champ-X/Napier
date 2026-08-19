import { Download, KeyRound, Pencil, Play } from "lucide-react";

import { copy } from "./copy";
import {
  formatDateTime,
  formatScore,
  runLabel,
  shortId,
} from "./evaluation-suite-artifacts";
import { selectedModelAvailability } from "./model-selection-view-model";
import type { useEvaluationSuite } from "./use-evaluation-suite";

type EvaluationSuiteState = ReturnType<typeof useEvaluationSuite>;

export interface EvaluationSuiteRegisterProps {
  state: EvaluationSuiteState;
}

export function EvaluationSuiteRegister({
  state,
}: EvaluationSuiteRegisterProps) {
  const {
    sortedSuites,
    executions,
    models,
    runs,
    adjudications,
    busyId,
    selectedTrustAnchorId,
    editSuite,
    exportReceipt,
    exportSignedReceipt,
    execute,
  } = state;
  return (
    <div className="suite-register">
      {sortedSuites.length === 0 ? (
        <p className="empty-panel">{copy.lab.suite.empty}</p>
      ) : null}
      {sortedSuites.map((suite) => {
        const executionHistory = executions
          .filter((execution) => execution.suiteId === suite.id)
          .sort((left, right) =>
            right.finishedAt.localeCompare(left.finishedAt),
          );
        const latestExecution = executionHistory.find(
          (execution) => execution.suiteRevision === suite.revision,
        );
        const suiteEvaluator = selectedModelAvailability(
          models,
          `${suite.evaluatorModel.provider}/${suite.evaluatorModel.id}`,
        );
        return (
          <article key={suite.id} className="suite-docket">
            <header>
              <div>
                <span>
                  {copy.lab.suite.revision} {suite.revision}
                </span>
                <h4>{suite.name}</h4>
              </div>
              <strong
                className={`suite-status suite-status-${latestExecution?.status ?? "idle"}`}
              >
                {latestExecution
                  ? copy.lab.suite.statuses[latestExecution.status]
                  : copy.lab.suite.neverRun}
              </strong>
            </header>
            <dl>
              <div>
                <dt>{copy.lab.suite.cases}</dt>
                <dd>{suite.candidateRunIds.length}</dd>
              </div>
              <div>
                <dt>{copy.lab.suite.passRate}</dt>
                <dd>{Math.round(suite.gate.minimumPassRate * 100)}%</dd>
              </div>
              <div>
                <dt>{copy.lab.suite.candidateScore}</dt>
                <dd>{suite.gate.minimumCandidateScore.toFixed(1)}</dd>
              </div>
              <div>
                <dt>{copy.lab.suite.evaluator}</dt>
                <dd>
                  {suite.evaluatorModel.provider}/{suite.evaluatorModel.id}
                </dd>
              </div>
            </dl>
            {!suiteEvaluator.configured ? (
              <p className="suite-error" role="status">
                {copy.modelUnavailableHint}
              </p>
            ) : null}
            {latestExecution ? (
              <div className="suite-result">
                <div>
                  <span>{copy.lab.suite.latest}</span>
                  <strong>{Math.round(latestExecution.passRate * 100)}%</strong>
                  <small>
                    {latestExecution.passedCount}/
                    {latestExecution.results.length}
                  </small>
                </div>
                <div>
                  <span>{copy.lab.suite.average}</span>
                  <strong>
                    {latestExecution.averageCandidateScore?.toFixed(2) ?? "–"}
                  </strong>
                  <small>/ 5</small>
                </div>
                <code title={latestExecution.contentSha256}>
                  {latestExecution.contentSha256.slice(0, 12)}
                </code>
              </div>
            ) : null}
            {latestExecution ? (
              <section
                className="suite-case-evidence"
                aria-label={copy.lab.suite.caseEvidence}
              >
                <header>
                  <span>{copy.lab.suite.caseEvidence}</span>
                  <code>{latestExecution.results.length}</code>
                </header>
                <ol>
                  {latestExecution.results.map((result) => {
                    const candidateIndex = runs.findIndex(
                      (run) => run.id === result.candidateRunId,
                    );
                    const candidate = runs[candidateIndex];
                    const adjudication = adjudications.find(
                      (item) => item.evaluationId === result.evaluationId,
                    );
                    const truth = adjudication?.revisions.at(-1);
                    return (
                      <li key={result.evaluationId}>
                        <header>
                          <span>
                            {candidate
                              ? runLabel(candidate, candidateIndex)
                              : shortId(result.candidateRunId)}
                          </span>
                          <strong
                            className={`suite-status suite-status-${result.status}`}
                          >
                            {copy.lab.suite.statuses[result.status]}
                          </strong>
                        </header>
                        <div className="suite-case-scores">
                          <span>
                            {copy.lab.suite.baselineScore}
                            <strong>
                              {formatScore(result.baselineAverageScore)}
                            </strong>
                          </span>
                          <span>
                            {copy.lab.suite.candidateScoreShort}
                            <strong>
                              {formatScore(result.candidateAverageScore)}
                            </strong>
                          </span>
                          <span>
                            {copy.lab.verdicts[result.verdict]}
                            <code title={result.evaluationSha256}>
                              {result.evaluationSha256.slice(0, 12)}
                            </code>
                          </span>
                        </div>
                        <div
                          className={`suite-case-truth ${truth?.expectedVerdict === result.verdict ? "is-agreed" : truth ? "is-diverged" : ""}`}
                        >
                          <span>{copy.lab.calibration.expectedVerdict}</span>
                          <strong>
                            {truth
                              ? copy.lab.verdicts[truth.expectedVerdict]
                              : copy.lab.calibration.unreviewed}
                          </strong>
                          {truth ? (
                            <code>
                              {copy.lab.calibration.revision} {truth.revision}
                            </code>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ) : null}
            {executionHistory.length > 0 ? (
              <details className="suite-history">
                <summary>
                  <span>{copy.lab.suite.history}</span>
                  <code>{executionHistory.length}</code>
                </summary>
                <ol>
                  {executionHistory.slice(0, 5).map((execution) => (
                    <li key={execution.id}>
                      <span>
                        {copy.lab.suite.revision} {execution.suiteRevision}
                      </span>
                      <strong
                        className={`suite-status suite-status-${execution.status}`}
                      >
                        {copy.lab.suite.statuses[execution.status]}
                      </strong>
                      <code title={execution.contentSha256}>
                        {execution.contentSha256.slice(0, 12)}
                      </code>
                      <time dateTime={execution.finishedAt}>
                        {formatDateTime(execution.finishedAt)}
                      </time>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
            <footer>
              <button
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => editSuite(suite)}
              >
                <Pencil size={11} aria-hidden="true" />
                {copy.lab.suite.edit}
              </button>
              <button
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => void exportReceipt(suite)}
              >
                <Download size={11} aria-hidden="true" />
                {busyId === `receipt:${suite.id}`
                  ? copy.lab.suite.exportingReceipt
                  : copy.lab.suite.receipt}
              </button>
              <button
                type="button"
                title={
                  selectedTrustAnchorId
                    ? copy.lab.suite.signedReceipt
                    : copy.lab.casebook.qualification.noSigner
                }
                disabled={Boolean(busyId) || !selectedTrustAnchorId}
                onClick={() => void exportSignedReceipt(suite)}
              >
                <KeyRound size={11} aria-hidden="true" />
                {busyId === `signed-receipt:${suite.id}`
                  ? copy.lab.suite.exportingSignedReceipt
                  : copy.lab.suite.signedReceipt}
              </button>
              <button
                className="suite-run-button"
                type="button"
                disabled={Boolean(busyId) || !suiteEvaluator.configured}
                onClick={() => void execute(suite.id)}
              >
                <Play size={11} aria-hidden="true" />
                {busyId === suite.id
                  ? copy.lab.suite.running
                  : copy.lab.suite.run}
              </button>
            </footer>
          </article>
        );
      })}
    </div>
  );
}
