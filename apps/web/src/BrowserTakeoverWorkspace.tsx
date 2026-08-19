import { X } from "lucide-react";
import type { MouseEvent } from "react";

import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import type { BrowserTakeoverSnapshot } from "@napier/contracts/browser-takeover";

import { browserLiveCopy } from "./browser-live-copy";
import { browserTakeoverLiveMatchesSnapshot } from "./browser-takeover-visual";
import type {
  BrowserTakeoverBinding,
  BrowserTakeoverExecute,
} from "./browser-takeover-view";

export interface BrowserTakeoverWorkspaceProps {
  snapshot: BrowserTakeoverSnapshot | undefined;
  binding: BrowserTakeoverBinding | undefined;
  busy: boolean;
  liveImageUrl: string;
  liveReceipt: BrowserLiveViewReceipt;
  onVisualClick: (event: MouseEvent<HTMLButtonElement>) => void;
  execute: BrowserTakeoverExecute;
}

export function BrowserTakeoverWorkspace({
  snapshot,
  binding,
  busy,
  liveImageUrl,
  liveReceipt,
  onVisualClick,
  execute,
}: BrowserTakeoverWorkspaceProps) {
  const copy = browserLiveCopy.takeover;
  if (!snapshot) {
    return (
      <p className="browser-takeover-empty">
        {busy ? copy.readingTab : copy.refreshForRefs}
      </p>
    );
  }
  return (
    <>
      <div className="browser-takeover-tabs" aria-label={copy.tabs}>
        {snapshot.tabs.map((tab) => (
          <div className={tab.active ? "is-active" : ""} key={tab.tabId}>
            <button
              type="button"
              disabled={busy || tab.active}
              onClick={() =>
                binding &&
                void execute({
                  ...binding,
                  action: "tab_switch",
                  tabId: tab.tabId,
                })
              }
              title={`URL ${tab.currentUrlSha256}`}
            >
              {tab.tabId}
              <span>{tab.title || tab.url}</span>
            </button>
            <button
              type="button"
              aria-label={`${copy.closeTab} ${tab.tabId}`}
              disabled={busy || snapshot.tabCount === 1}
              onClick={() =>
                binding &&
                void execute({
                  ...binding,
                  action: "tab_close",
                  tabId: tab.tabId,
                })
              }
            >
              <X size={11} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <button
        className="browser-takeover-viewport"
        type="button"
        disabled={
          busy ||
          !binding ||
          !browserTakeoverLiveMatchesSnapshot(liveReceipt, snapshot)
        }
        onClick={onVisualClick}
        aria-label={copy.verifiedViewport}
      >
        <img src={liveImageUrl} alt={copy.verifiedViewportAlt} />
      </button>
      <pre aria-label={copy.ariaSnapshot}>
        {snapshot.snapshot || copy.emptySnapshot}
      </pre>
    </>
  );
}
