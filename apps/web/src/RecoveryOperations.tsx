import type {
  RunRecoveryCheckpoint,
  RecoveryOperationStatus,
} from "@napier/contracts/manual-run-recovery";
import type { RunOrchestrationStateV1 } from "@napier/contracts/run-orchestration-state";
import { recoveryOperationsCopy as copy } from "./recovery-operations-copy";

export interface RecoveryOperationsProps {
  checkpoint: RunRecoveryCheckpoint | undefined;
  orchestration?: RunOrchestrationStateV1 | undefined;
}

export function RecoveryOperations({
  checkpoint,
  orchestration,
}: RecoveryOperationsProps) {
  if (!checkpoint) return <p>{copy.missing}</p>;
  if (checkpoint.evidenceLimited) return <p>{copy.limited}</p>;
  const opsByStart = new Map(
    (orchestration?.openToolOps ?? []).map((operation) => [
      operation.startedSeq,
      operation,
    ]),
  );
  return (
    <details className="recovery-operations">
      <summary>
        {copy.facts} · {checkpoint.total}
      </summary>
      {orchestration ? (
        <p>
          {copy.orchestration}: {copy.phases[orchestration.phase]}
          {orchestration.cancelRequested
            ? ` · ${copy.cancelRequested}`
            : ""}
        </p>
      ) : null}
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
        {checkpoint.operations.map((operation) => {
          const orch = opsByStart.get(operation.startedSeq);
          return (
            <li key={operation.startedSeq}>
              <div>
                <code>{operation.toolName}</code>
                <strong>{copy.statuses[operation.status]}</strong>
              </div>
              <p>{copy.reasons[operation.reason]}</p>
              {orch ? (
                <small>
                  {copy.replayClasses[orch.replayClass]} ·{" "}
                  {copy.toolPhases[orch.toolPhase]}
                </small>
              ) : null}
              <small>
                {copy.throughSeq} {operation.evidenceSeq}
              </small>
            </li>
          );
        })}
      </ol>
      {checkpoint.omitted > 0 ? (
        <p>
          {copy.omitted} ({checkpoint.omitted})
        </p>
      ) : null}
    </details>
  );
}
