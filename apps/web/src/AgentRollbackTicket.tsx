import { RotateCcw, X } from "lucide-react";

import type { AgentProfile, AgentProfileRevision } from "@napier/contracts";

import { agentProfileDelta } from "./agent-profile-delta";
import { contextCopy } from "./context-copy";
import "./agent-revision-shared.css";
import "./agent-rollback-ticket.css";

export interface AgentRollbackTicketProps {
  current: AgentProfile;
  target: AgentProfileRevision;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function AgentRollbackTicket({
  current,
  target,
  busy,
  onCancel,
  onConfirm,
}: AgentRollbackTicketProps) {
  const rollbackFields = agentProfileDelta(current, target.profile);
  return (
    <aside
      className="agent-rollback-ticket"
      aria-labelledby="agent-rollback-title"
    >
      <header>
        <div>
          <span>{contextCopy.rollbackTarget}</span>
          <h4 id="agent-rollback-title">{contextCopy.rollbackTitle}</h4>
        </div>
        <button
          type="button"
          disabled={busy}
          aria-label={contextCopy.cancelRollback}
          onClick={onCancel}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </header>
      <p>{contextCopy.rollbackBody}</p>
      <dl>
        <RevisionMetric label={contextCopy.rollbackTarget} revision={target.revision} />
        <RevisionMetric label={contextCopy.rollbackResult} revision={current.revision + 1} />
      </dl>
      <div className="agent-rollback-fields">
        <span>{contextCopy.rollbackChanges}</span>
        {rollbackFields.length > 0 ? (
          <ul>
            {rollbackFields.map((field) => (
              <li key={field}>{contextCopy.profileFields[field]}</li>
            ))}
          </ul>
        ) : (
          <small>{contextCopy.rollbackMatches}</small>
        )}
      </div>
      <code title={target.contentSha256}>
        {contextCopy.profileDigest} {target.contentSha256.slice(0, 12)}
      </code>
      <div className="agent-rollback-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          {contextCopy.cancelRollback}
        </button>
        <button
          className="agent-rollback-confirm"
          type="button"
          disabled={busy || rollbackFields.length === 0}
          onClick={onConfirm}
        >
          <RotateCcw size={14} aria-hidden="true" />
          {busy ? contextCopy.rollingBack : contextCopy.confirmRollback}
        </button>
      </div>
    </aside>
  );
}

function RevisionMetric({ label, revision }: { label: string; revision: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{contextCopy.revision} {revision}</dd>
    </div>
  );
}
