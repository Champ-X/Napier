import { Square } from "lucide-react";

import { workspaceProcessCopy as copy } from "./workspace-process-copy";
import type {
  WorkspaceProcessCardView,
  WorkspaceProcessPanelState,
  WorkspaceProcessSession,
} from "./workspace-process-card-types";

export interface WorkspaceProcessActionsProps {
  state: WorkspaceProcessPanelState;
  card: WorkspaceProcessCardView;
  session: WorkspaceProcessSession;
  expanded: boolean;
  deltaExpanded: boolean;
}

export function WorkspaceProcessActions({
  state,
  card,
  session,
  expanded,
  deltaExpanded,
}: WorkspaceProcessActionsProps) {
  return (
    <div className="process-actions">
      <button
        type="button"
        className="secondary-button"
        onClick={() => void state.toggleOutput(session)}
        aria-expanded={expanded}
      >
        {expanded ? copy.hideOutput : copy.showOutput}
      </button>
      {!card.running ? (
        <button
          type="button"
          className="secondary-button"
          disabled={state.deltaBusyId === card.id}
          onClick={() => void state.toggleDelta(session)}
          aria-expanded={deltaExpanded}
        >
          {deltaExpanded ? copy.hideDelta : copy.showDelta}
        </button>
      ) : null}
      {card.running ? (
        <button
          type="button"
          className="secondary-button danger"
          disabled={state.busyId === card.id}
          onClick={() => void state.cancel(card.id)}
        >
          <Square size={12} aria-hidden="true" />
          {state.busyId === card.id ? copy.cancelling : copy.cancel}
        </button>
      ) : null}
    </div>
  );
}
