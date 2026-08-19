import { History } from "lucide-react";

import type { AgentProfile, AgentProfileRevision } from "@napier/contracts";

import { AgentRevisionCard } from "./AgentRevisionCard";
import { AgentRollbackTicket } from "./AgentRollbackTicket";
import { contextCopy } from "./context-copy";
import "./agent-revision-history.css";

export interface AgentRevisionHistoryProps {
  current: AgentProfile;
  revisions: AgentProfileRevision[];
  loading: boolean;
  busy: boolean;
  rollbackTarget: AgentProfileRevision | undefined;
  onReviewRollback: (revision: AgentProfileRevision) => void;
  onCancelRollback: () => void;
  onConfirmRollback: () => void;
}

export function AgentRevisionHistory({
  current,
  revisions,
  loading,
  busy,
  rollbackTarget,
  onReviewRollback,
  onCancelRollback,
  onConfirmRollback,
}: AgentRevisionHistoryProps) {
  return (
    <section
      className="agent-history-register"
      aria-labelledby="agent-history-title"
    >
      <header className="context-section-heading">
        <div className="context-section-glyph" aria-hidden="true">
          <History size={16} />
        </div>
        <div>
          <span>{contextCopy.historyEyebrow}</span>
          <h3 id="agent-history-title">{contextCopy.history}</h3>
        </div>
        <span className="credential-count">
          {revisions.length.toString().padStart(2, "0")}
        </span>
      </header>
      <p className="agent-history-intro">{contextCopy.historyBody}</p>
      {rollbackTarget ? (
        <AgentRollbackTicket
          current={current}
          target={rollbackTarget}
          busy={busy}
          onCancel={onCancelRollback}
          onConfirm={onConfirmRollback}
        />
      ) : null}
      {loading ? (
        <p className="empty-panel" role="status">{contextCopy.historyLoading}</p>
      ) : (
        <div className="agent-revision-list">
          {revisions.map((revision) => (
            <AgentRevisionCard
              key={revision.revision}
              current={current}
              revision={revision}
              busy={busy}
              onReviewRollback={onReviewRollback}
            />
          ))}
        </div>
      )}
    </section>
  );
}
