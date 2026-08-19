import { formatProcessDate as formatDate } from "./process-panel-format";
import { workspaceProcessCopy as copy } from "./workspace-process-copy";
import {
  WorkspaceProcessFailureRecoveryRow,
  WorkspaceProcessLocalServiceRow,
} from "./WorkspaceProcessLocalServiceRow";
import type { WorkspaceProcessCardView } from "./workspace-process-card-types";

export interface WorkspaceProcessFactsProps {
  card: WorkspaceProcessCardView;
}

export function WorkspaceProcessFacts({ card }: WorkspaceProcessFactsProps) {
  return (
    <dl>
      <div>
        <dt>{copy.scope}</dt>
        <dd>{card.scopeLabel}</dd>
      </div>
      <div>
        <dt>{copy.limits}</dt>
        <dd>{card.limitLabel}</dd>
      </div>
      <WorkspaceProcessLocalServiceRow
        service={card.localService}
        label={copy.localService}
      />
      {card.failureRecovery ? (
        <WorkspaceProcessFailureRecoveryRow status={card.compensationStatus} />
      ) : null}
      <div>
        <dt>{copy.output}</dt>
        <dd>{card.outputLabel}</dd>
      </div>
      <div>
        <dt>{copy.stdin}</dt>
        <dd>
          {card.stdinLabel}
          {card.stdinHash ? ` · ${card.stdinHash}` : ""}
        </dd>
      </div>
      <div className={`process-delta-summary is-${card.workspaceDeltaState}`}>
        <dt>{copy.workspaceDelta}</dt>
        <dd>{card.workspaceDeltaLabel}</dd>
      </div>
      <div>
        <dt>{copy.commandHash}</dt>
        <dd>{card.commandHash}</dd>
      </div>
      <div>
        <dt>{copy.started}</dt>
        <dd>{formatDate(card.startedAt)}</dd>
      </div>
      <div>
        <dt>{copy.duration}</dt>
        <dd>{card.durationLabel}</dd>
      </div>
      {card.settledAt ? (
        <div>
          <dt>{copy.settled}</dt>
          <dd>{formatDate(card.settledAt)}</dd>
        </div>
      ) : null}
      {card.resultHashes ? (
        <div>
          <dt>{copy.outputHashes}</dt>
          <dd>{card.resultHashes}</dd>
        </div>
      ) : null}
      {card.workspaceDeltaHashes ? (
        <div>
          <dt>{copy.deltaHashes}</dt>
          <dd>{card.workspaceDeltaHashes}</dd>
        </div>
      ) : null}
    </dl>
  );
}
