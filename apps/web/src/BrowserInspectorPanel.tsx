import { Eye, MousePointerClick } from "lucide-react";

import type {
  CredentialReference,
  ModelSummary,
  RunEvent,
} from "@napier/contracts";
import type { SelectedModelAvailability } from "./model-selection-view-model";
import { browserLiveViewExpected } from "./browser-live-view-state";
import { BrowserUseLocalTaskPanel } from "./BrowserUseLocalTaskPanel";

export interface BrowserInspectorPanelProps {
  activeTab: string;
  events: readonly RunEvent[];
  activeRunId: string | undefined;
  taskContext: {
    models: readonly ModelSummary[];
    credentials: readonly CredentialReference[];
    selectedModel: SelectedModelAvailability;
  };
}

export function BrowserInspectorPanel({
  activeTab,
  events,
  activeRunId,
  taskContext,
}: BrowserInspectorPanelProps) {
  if (activeTab !== "browser") return null;
  const live =
    activeRunId !== undefined && browserLiveViewExpected(events, activeRunId);
  return (
    <section
      className="panel-section browser-inspector-panel"
      aria-labelledby="browser-inspector-title"
    >
      <div className="panel-heading">
        <div>
          <span>LIVE SESSION</span>
          <h2 id="browser-inspector-title">Browser</h2>
        </div>
      </div>
      <div className="browser-inspector-card">
        <Eye size={18} aria-hidden="true" />
        <div>
          <strong>
            {live ? "Browser Live is active" : "No active Browser view"}
          </strong>
          <p>
            {live
              ? "Pause, Resume, Take control, and visual evidence stay with the task in the main workspace."
              : "Browser Live appears in the main workspace when the active Run has an open Browser Session."}
          </p>
        </div>
        <button type="button" disabled={!live} onClick={focusBrowserLive}>
          <MousePointerClick size={14} aria-hidden="true" />
          Open in task
        </button>
      </div>
      <BrowserUseLocalTaskPanel
        models={taskContext.models}
        credentials={taskContext.credentials}
        selectedModel={taskContext.selectedModel}
      />
    </section>
  );
}

export function focusBrowserLive(): void {
  const target = document.querySelector<HTMLElement>(".browser-live-view");
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
  target?.focus({ preventScroll: true });
}

export default BrowserInspectorPanel;
