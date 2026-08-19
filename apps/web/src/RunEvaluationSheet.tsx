import type { RunEvaluationRecord } from "@napier/contracts";

import { copy } from "./copy";
import {
  contextCoverageStatusLabel,
  traceSummaryCoverageStatusLabel,
} from "./run-lab-format";

export interface RunEvaluationSheetProps {
  evaluation: RunEvaluationRecord | undefined;
}

export function RunEvaluationSheet({
  evaluation: latestEvaluation,
}: RunEvaluationSheetProps) {
  return (
    <section className="evaluation-sheet" aria-labelledby="evaluation-title">
      <header>
        <div>
          <span>{copy.lab.verdict}</span>
          <h3 id="evaluation-title">
            {latestEvaluation
              ? copy.lab.verdicts[latestEvaluation.verdict]
              : copy.lab.noVerdict}
          </h3>
        </div>
        {latestEvaluation ? (
          <span className={`verdict-stamp verdict-${latestEvaluation.verdict}`}>
            {copy.lab.verdicts[latestEvaluation.verdict]}
          </span>
        ) : null}
      </header>
      {latestEvaluation ? (
        <>
          <p className="evaluation-reason">{latestEvaluation.reason}</p>
          {latestEvaluation.evidence ? (
            <div className="evaluation-evidence">
              <span>{copy.lab.evidence}</span>
              <p>{latestEvaluation.evidence}</p>
            </div>
          ) : null}
          {latestEvaluation.scores.length > 0 ? (
            <table className="rubric-table">
              <caption>{copy.lab.rubric}</caption>
              <thead>
                <tr>
                  <th scope="col">{latestEvaluation.rubric.name}</th>
                  <th scope="col">{copy.lab.left}</th>
                  <th scope="col">{copy.lab.right}</th>
                </tr>
              </thead>
              <tbody>
                {latestEvaluation.rubric.criteria.map((criterion) => {
                  const score = latestEvaluation.scores.find(
                    (candidate) => candidate.criterionId === criterion.id,
                  );
                  return (
                    <tr key={criterion.id} title={score?.reason}>
                      <th scope="row">{criterion.name}</th>
                      <td>{score?.leftScore ?? "-"}</td>
                      <td>{score?.rightScore ?? "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
          <div className="evaluation-hashes">
            <span>{copy.lab.hashes}</span>
            <code>
              {copy.lab.left} {latestEvaluation.leftSnapshotSha256.slice(0, 12)}
            </code>
            <code>
              {copy.lab.right}{" "}
              {latestEvaluation.rightSnapshotSha256.slice(0, 12)}
            </code>
            {latestEvaluation.comparisonGovernance ? (
              <>
                <code>
                  {copy.lab.governance}{" "}
                  {latestEvaluation.comparisonGovernance.contentSha256.slice(
                    0,
                    12,
                  )}
                </code>
                <code>
                  {copy.lab.contextCoverage}{" "}
                  {contextCoverageStatusLabel(
                    latestEvaluation.comparisonGovernance.contextCoverageStatus,
                  )}
                </code>
                <code>
                  {copy.lab.contextCoverageDiagnostics}{" "}
                  {latestEvaluation.comparisonGovernance.contextCoverageDiagnosticsSha256.slice(
                    0,
                    12,
                  )}
                </code>
                {latestEvaluation.comparisonGovernance
                  .traceSummaryBoundaryStatus ? (
                  <code>
                    {copy.lab.traceSummaryCoverage}{" "}
                    {traceSummaryCoverageStatusLabel(
                      latestEvaluation.comparisonGovernance
                        .traceSummaryBoundaryStatus,
                    )}
                  </code>
                ) : null}
                {latestEvaluation.comparisonGovernance
                  .traceSummaryBoundaryDiagnosticsSha256 ? (
                  <code>
                    {copy.lab.traceSummaryDiagnostics}{" "}
                    {latestEvaluation.comparisonGovernance.traceSummaryBoundaryDiagnosticsSha256.slice(
                      0,
                      12,
                    )}
                  </code>
                ) : null}
                {latestEvaluation.comparisonGovernance
                  .traceSummaryBoundaryDeltaSha256 ? (
                  <code>
                    {copy.lab.traceSummaryDelta}{" "}
                    {latestEvaluation.comparisonGovernance.traceSummaryBoundaryDeltaSha256.slice(
                      0,
                      12,
                    )}
                  </code>
                ) : null}
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
