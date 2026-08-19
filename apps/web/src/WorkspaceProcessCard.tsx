import { Terminal } from "lucide-react";

import { workspaceProcessCopy as copy } from "./workspace-process-copy";
import { WorkspaceProcessActions } from "./WorkspaceProcessActions";
import { WorkspaceProcessEvidence } from "./WorkspaceProcessEvidence";
import { WorkspaceProcessFacts } from "./WorkspaceProcessFacts";
import { WorkspaceProcessInput } from "./WorkspaceProcessInput";
import { WorkspaceProcessRollback } from "./WorkspaceProcessRollback";
import type {
  WorkspaceProcessCardView,
  WorkspaceProcessPanelState,
} from "./workspace-process-card-types";

export interface WorkspaceProcessCardProps {
  state: WorkspaceProcessPanelState;
  card: WorkspaceProcessCardView;
}

export function WorkspaceProcessCard({
  state,
  card,
}: WorkspaceProcessCardProps) {
  const session = state.sessions.find((candidate) => candidate.id === card.id)!;
  const expanded = state.selectedId === card.id;
  const deltaExpanded = state.deltaId === card.id;
  return (
    <article className="process-card" key={card.id}>
      <header>
        <Terminal size={15} aria-hidden="true" />
        <div>
          <strong>{card.id}</strong>
          <span>{card.runtimeLabel}</span>
        </div>
        <span className={`process-status is-${card.status}`} role="status">
          {card.statusLabel}
        </span>
      </header>
      <WorkspaceProcessFacts card={card} />
      {card.interruptionReason ? (
        <p className="process-interruption">{card.interruptionReason}</p>
      ) : null}
      <WorkspaceProcessActions
        state={state}
        card={card}
        session={session}
        expanded={expanded}
        deltaExpanded={deltaExpanded}
      />
      {!card.running ? (
        <WorkspaceProcessRollback
          threadId={state.threadId}
          session={session}
          onApplied={state.refreshAfterRollback}
        />
      ) : null}
      <WorkspaceProcessInput state={state} card={card} session={session} />
      {state.inputReceipt?.processId === card.id ? (
        <span className="process-input-receipt" role="status">
          {copy.inputReceipt} {state.inputReceipt.contentSha256.slice(0, 12)}
        </span>
      ) : null}
      <WorkspaceProcessEvidence
        state={state}
        card={card}
        session={session}
        expanded={expanded}
        deltaExpanded={deltaExpanded}
      />
    </article>
  );
}
