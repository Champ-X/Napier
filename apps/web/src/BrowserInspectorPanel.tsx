import { Eye, MousePointerClick } from "lucide-react";

import type {
  CredentialReference,
  ModelSummary,
  RunEvent,
} from "@napier/contracts";
import type { SelectedModelAvailability } from "./model-selection-view-model";
import { browserLiveViewExpected } from "./browser-live-view-state";
import { browserLiveCopy } from "./browser-live-copy";
import { motionScrollBehavior } from "./reduced-motion";
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
  const inspector = browserLiveCopy.inspector;
  return (
    <section
      className="panel-section browser-inspector-panel"
      aria-labelledby="browser-inspector-title"
    >
      <div className="panel-heading">
        <div>
          <span>{inspector.eyebrow}</span>
          <h2 id="browser-inspector-title">{inspector.title}</h2>
        </div>
      </div>
      <div className="browser-inspector-card">
        <Eye size={18} aria-hidden="true" />
        <div>
          <strong>{live ? inspector.active : inspector.inactive}</strong>
          <p>
            {live ? inspector.activeDescription : inspector.inactiveDescription}
          </p>
        </div>
        <button type="button" disabled={!live} onClick={focusBrowserLive}>
          <MousePointerClick size={14} aria-hidden="true" />
          {inspector.open}
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
  target?.scrollIntoView({ behavior: motionScrollBehavior(), block: "center" });
  target?.focus({ preventScroll: true });
}

export default BrowserInspectorPanel;
