import type {
  RunRecoveryCheckpoint,
  RecoveryOperationStatus,
} from "@napier/contracts/manual-run-recovery";
import { recoveryOperationsCopy as copy } from "./recovery-operations-copy";

export interface RecoveryOperationsProps {
  checkpoint: RunRecoveryCheckpoint | undefined;
}

export function RecoveryOperations({ checkpoint }: RecoveryOperationsProps) {
  if (!checkpoint) return <p>{copy.missing}</p>;
  if (checkpoint.evidenceLimited) return <p>{copy.limited}</p>;
  return (
    <details className="recovery-operations">
      <summary>
        {copy.facts} · {checkpoint.total}
      </summary>
      <p>{copy.historical}</p>
      <dl className="recovery-counts">
        {(Object.keys(copy.statuses) as RecoveryOperationStatus[]).map(
          (status) => (
            <div key={status}>
              <dt>{copy.statuses[status]}</dt>
              <dd>{checkpoint.counts[status]}</dd>
            </div>
          ),
        )}
      </dl>
      {checkpoint.total === 0 ? <p>{copy.empty}</p> : null}
      <ol className="recovery-operation-list">
        {checkpoint.operations.map((operation) => (
          <li key={operation.startedSeq}>
            <div>
              <code>{operation.toolName}</code>
              <strong>{copy.statuses[operation.status]}</strong>
            </div>
            <p>{copy.reasons[operation.reason]}</p>
            <small>
              {copy.throughSeq} {operation.evidenceSeq}
            </small>
          </li>
        ))}
      </ol>
      {checkpoint.omitted > 0 ? (
        <p>
          {copy.omitted} ({checkpoint.omitted})
        </p>
      ) : null}
    </details>
  );
}
