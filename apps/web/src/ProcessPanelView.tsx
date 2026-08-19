import { RefreshCw } from "lucide-react";

import { workspaceProcessCopy as copy } from "./workspace-process-copy";
import { WorkspaceProcessCard } from "./WorkspaceProcessCard";
import type { useProcessPanel } from "./use-process-panel";

type ProcessPanelState = ReturnType<typeof useProcessPanel>;

export interface ProcessPanelViewProps {
  state: ProcessPanelState;
}

export function ProcessPanelView({ state }: ProcessPanelViewProps) {
  const { cards, error, loadSessions } = state;
  return (
    <section
      className="panel-section process-panel"
      aria-labelledby="process-panel-title"
    >
      <div className="panel-heading">
        <div>
          <span>{copy.eyebrow}</span>
          <h3 id="process-panel-title">{copy.title}</h3>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={() => void loadSessions()}
          aria-label={copy.refresh}
          title={copy.refresh}
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>
      <p className="quiet-copy">{copy.description}</p>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {cards.length === 0 ? (
        <p className="empty-panel">{copy.noSessions}</p>
      ) : (
        <div className="process-list">
          {cards.map((card) => (
            <WorkspaceProcessCard key={card.id} state={state} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}
