import { Globe2, PanelRightClose } from "lucide-react";

import { BrowserLiveViewPanel } from "./BrowserLiveViewPanel";
import { browserLiveViewExpected } from "./browser-live-view-state";
import type { BrowserLiveViewPanelProps } from "./BrowserLiveViewPanel";
import { workspaceEvidenceCopy as copy } from "./workspace-evidence-copy";

interface WorkbenchBrowserRailProps extends BrowserLiveViewPanelProps {
  onClose(): void;
}

export function WorkbenchBrowserRail({
  threadId,
  runId,
  events,
  confirmationAction,
  onClose,
}: WorkbenchBrowserRailProps) {
  if (!browserLiveViewExpected(events, runId)) {
    return null;
  }
  return (
    <aside className="workbench-browser-rail" aria-label={copy.browserPreview}>
      <header className="workbench-browser-rail-heading">
        <span>
          <Globe2 size={14} aria-hidden="true" />
          {copy.browserPreview}
        </span>
        <button
          type="button"
          aria-label={copy.hideBrowser}
          title={copy.hideBrowser}
          onClick={onClose}
        >
          <PanelRightClose size={15} aria-hidden="true" />
        </button>
      </header>
      <BrowserLiveViewPanel
        threadId={threadId}
        runId={runId}
        events={events}
        {...(confirmationAction ? { confirmationAction } : {})}
      />
    </aside>
  );
}
