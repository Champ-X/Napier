import { BrowserLiveViewPanel } from "./BrowserLiveViewPanel";
import { browserLiveViewExpected } from "./browser-live-view-state";
import type { BrowserLiveViewPanelProps } from "./BrowserLiveViewPanel";

export function WorkbenchBrowserRail({
  threadId,
  runId,
  events,
  confirmationAction,
}: BrowserLiveViewPanelProps) {
  if (!browserLiveViewExpected(events, runId)) {
    return null;
  }
  return (
    <aside className="workbench-browser-rail" aria-label="Browser live view">
      <BrowserLiveViewPanel
        threadId={threadId}
        runId={runId}
        events={events}
        {...(confirmationAction ? { confirmationAction } : {})}
      />
    </aside>
  );
}
