import type { EvaluationReviewerBallot } from "@napier/contracts";

import { copy } from "./copy";

export interface EvaluationConsensusRosterProps {
  ballots: EvaluationReviewerBallot[];
  disabled: boolean;
  onEdit(ballot: EvaluationReviewerBallot): void;
}

export function EvaluationConsensusRoster({
  ballots,
  disabled,
  onEdit,
}: EvaluationConsensusRosterProps) {
  return (
    <div className="consensus-roster">
      <header>
        <span>{copy.lab.calibration.consensus.roster}</span>
        <code>{ballots.length}/9</code>
      </header>
      {ballots.length ? (
        <ol>
          {ballots.map((ballot) => {
            const revision = ballot.revisions.at(-1)!;
            return (
              <li key={ballot.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onEdit(ballot)}
                >
                  <span>
                    <strong>{revision.reviewerName}</strong>
                    <small>{ballot.reviewerId}</small>
                  </span>
                  <span>
                    <strong>
                      {copy.lab.verdicts[revision.expectedVerdict]}
                    </strong>
                    <code title={revision.contentSha256}>
                      r{revision.revision} ·{" "}
                      {revision.contentSha256.slice(0, 8)}
                    </code>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p>{copy.lab.calibration.consensus.emptyRoster}</p>
      )}
    </div>
  );
}
