import { RefreshCw, Send } from "lucide-react";

import type { BrowserTakeoverAction } from "@napier/contracts/browser-takeover";
import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";

import { browserLiveCopy } from "./browser-live-copy";
import { BrowserTakeoverActionControls } from "./BrowserTakeoverActionControls";
import { BrowserTakeoverOutput } from "./BrowserTakeoverOutput";
import { BrowserTakeoverQuickControls } from "./BrowserTakeoverQuickControls";
import { BrowserTakeoverWorkspace } from "./BrowserTakeoverWorkspace";
import { useBrowserTakeoverDesk } from "./use-browser-takeover-desk";
import "./browser-takeover-shell.css";
import "./browser-takeover-controls.css";

export interface BrowserTakeoverDeskProps {
  threadId: string;
  runId: string;
  liveImageUrl: string;
  liveReceipt: BrowserLiveViewReceipt;
  onActivityChange: (action: BrowserTakeoverAction | undefined) => void;
  onReturnToAgent: () => Promise<void>;
}

export function BrowserTakeoverDesk({
  threadId,
  runId,
  liveImageUrl,
  liveReceipt,
  onActivityChange,
  onReturnToAgent,
}: BrowserTakeoverDeskProps) {
  const controller = useBrowserTakeoverDesk(
    threadId,
    runId,
    liveReceipt,
    onActivityChange,
  );
  const copy = browserLiveCopy.takeover;
  return (
    <section className="browser-takeover-desk" aria-label={copy.label}>
      <header>
        <div>
          <span>{copy.eyebrow}</span>
          <strong>{copy.title}</strong>
        </div>
        <button
          type="button"
          aria-busy={controller.busy}
          disabled={controller.busy}
          onClick={() => void controller.refresh()}
        >
          <RefreshCw size={12} aria-hidden="true" />
          {copy.freshRefs}
        </button>
      </header>
      <BrowserTakeoverWorkspace
        snapshot={controller.snapshot}
        binding={controller.binding}
        busy={controller.busy}
        liveImageUrl={liveImageUrl}
        liveReceipt={liveReceipt}
        onVisualClick={controller.visualClick}
        execute={controller.execute}
      />
      <BrowserTakeoverActionControls
        form={controller.form}
        binding={controller.binding}
        tabCount={controller.snapshot?.tabCount}
        busy={controller.busy}
        onChange={controller.updateForm}
        onOpenTab={controller.openTab}
        onSubmit={controller.submitTargetAction}
      />
      <BrowserTakeoverQuickControls
        form={controller.form}
        binding={controller.binding}
        busy={controller.busy}
        onChange={controller.updateForm}
        execute={controller.execute}
      />
      <BrowserTakeoverOutput
        binding={controller.binding}
        snapshot={controller.snapshot}
        liveReceipt={liveReceipt}
        targetRef={controller.form.ref}
        allowCrossOrigin={controller.form.allowCrossOrigin}
        busy={controller.busy}
        execute={controller.execute}
      />
      <footer>
        <span>
          {controller.receipt
            ? `${controller.receipt.action} · op ${String(controller.receipt.sessionOperation)}`
            : controller.snapshot
              ? `${copy.snapshot} ${controller.snapshot.snapshotSha256.slice(0, 10)}`
              : copy.noSnapshot}
        </span>
        {controller.error ? <span role="alert">{controller.error}</span> : null}
        <button
          type="button"
          aria-busy={controller.busy}
          disabled={controller.busy}
          onClick={() => void onReturnToAgent()}
        >
          <Send size={12} aria-hidden="true" />
          {copy.returnToAgent}
        </button>
      </footer>
    </section>
  );
}
