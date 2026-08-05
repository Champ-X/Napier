import type {
  BrowserTakeoverAction,
  BrowserTakeoverKey,
  BrowserTakeoverActionReceipt,
  BrowserTakeoverSnapshot,
} from "@napier/contracts/browser-takeover";
import { BROWSER_TAKEOVER_KEYS } from "@napier/contracts/browser-takeover";
import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Clock,
  MousePointerClick,
  Plus,
  RefreshCw,
  Send,
  Keyboard,
  X,
} from "lucide-react";
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { formatApiErrorMessage } from "./api-error";
import { getBrowserTakeoverSnapshot } from "./browser-takeover-api";
import {
  browserTakeoverLiveMatchesSnapshot,
  browserViewportCoordinates,
} from "./browser-takeover-visual";
import { BrowserTakeoverOutput } from "./BrowserTakeoverOutput";
import { useBrowserTakeoverExecution } from "./use-browser-takeover-execution";

type TakeoverMode = "click" | "type" | "select";

export function BrowserTakeoverDesk({
  threadId,
  runId,
  liveImageUrl,
  liveReceipt,
  onActivityChange,
  onReturnToAgent,
}: {
  threadId: string;
  runId: string;
  liveImageUrl: string;
  liveReceipt: BrowserLiveViewReceipt;
  onActivityChange: (action: BrowserTakeoverAction | undefined) => void;
  onReturnToAgent: () => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<BrowserTakeoverSnapshot>();
  const [receipt, setReceipt] = useState<BrowserTakeoverActionReceipt>();
  const [mode, setMode] = useState<TakeoverMode>("click");
  const [ref, setRef] = useState("");
  const [value, setValue] = useState("");
  const [newTabUrl, setNewTabUrl] = useState("");
  const [selectedKey, setSelectedKey] = useState<BrowserTakeoverKey>("Enter");
  const [allowCrossOrigin, setAllowCrossOrigin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      setSnapshot(await getBrowserTakeoverSnapshot(threadId, runId));
    } catch (refreshError) {
      setSnapshot(undefined);
      setError(formatApiErrorMessage(refreshError));
    } finally {
      setBusy(false);
    }
  }, [runId, threadId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const binding = useMemo(
    () =>
      snapshot
        ? {
            expectedPauseStateSha256: snapshot.pauseStateSha256,
            expectedSessionIdSha256: snapshot.sessionIdSha256,
            expectedSessionOperation: snapshot.sessionOperation,
            expectedSnapshotSha256: snapshot.snapshotSha256,
            expectedActiveTabId: snapshot.activeTabId,
            expectedTabCount: snapshot.tabCount,
            expectedTabSetSha256: snapshot.tabSetSha256,
          }
        : undefined,
    [snapshot],
  );

  const execute = useBrowserTakeoverExecution({
    threadId,
    runId,
    onActivityChange,
    setBusy,
    setError,
    setReceipt,
    setSnapshot,
    clearPrivateState: () => {
      setRef("");
      setValue("");
      setNewTabUrl("");
      setAllowCrossOrigin(false);
    },
  });

  const submitTargetAction = useCallback(() => {
    if (!binding || !ref.trim()) return;
    const targetRef = ref.trim().toLowerCase();
    if (mode === "click") {
      void execute({
        ...binding,
        action: "click",
        ref: targetRef,
        ...(allowCrossOrigin ? { allowCrossOrigin: true } : {}),
      });
      return;
    }
    if (mode === "type") {
      void execute({
        ...binding,
        action: "type",
        ref: targetRef,
        text: value,
      });
      return;
    }
    const values = value
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (values.length === 0) return;
    void execute({
      ...binding,
      action: "select",
      ref: targetRef,
      values,
    });
  }, [allowCrossOrigin, binding, execute, mode, ref, value]);

  const openTab = useCallback(() => {
    if (!binding || !newTabUrl.trim()) return;
    void execute({
      ...binding,
      action: "tab_new",
      url: newTabUrl.trim(),
      ...(allowCrossOrigin ? { allowCrossOrigin: true } : {}),
    });
  }, [allowCrossOrigin, binding, execute, newTabUrl]);

  const visualClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (!binding) return;
      const image = event.currentTarget.querySelector("img");
      if (!image) return;
      const coordinates = browserViewportCoordinates(
        event.clientX,
        event.clientY,
        image.getBoundingClientRect(),
        liveReceipt,
      );
      if (!coordinates) return;
      void execute({
        ...binding,
        action: "visual_click",
        expectedLiveImageSha256: liveReceipt.imageSha256,
        expectedViewportWidth: liveReceipt.viewportWidth,
        expectedViewportHeight: liveReceipt.viewportHeight,
        ...coordinates,
        ...(allowCrossOrigin ? { allowCrossOrigin: true } : {}),
      });
    },
    [allowCrossOrigin, binding, execute, liveReceipt],
  );

  return (
    <section className="browser-takeover-desk" aria-label="Browser takeover">
      <header>
        <div>
          <span>OPERATOR CONTROL · PAUSE BOUND</span>
          <strong>Take control of this isolated Browser Session</strong>
        </div>
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          <RefreshCw size={12} aria-hidden="true" />
          Fresh refs
        </button>
      </header>

      {snapshot ? (
        <>
          <div className="browser-takeover-tabs" aria-label="Browser tabs">
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
                  aria-label={`Close ${tab.tabId}`}
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
            onClick={visualClick}
            aria-label="Click the verified Browser viewport"
          >
            <img
              src={liveImageUrl}
              alt="Verified Browser viewport for visual click"
            />
          </button>
          <pre aria-label="Untrusted Browser ARIA snapshot">
            {snapshot.snapshot || "(empty page snapshot)"}
          </pre>
        </>
      ) : (
        <p className="browser-takeover-empty">
          {busy ? "Reading the paused tab…" : "Refresh to obtain fresh refs."}
        </p>
      )}

      <div className="browser-takeover-controls">
        <div className="browser-takeover-new-tab">
          <label>
            New public URL
            <input
              type="url"
              value={newTabUrl}
              onChange={(event) => setNewTabUrl(event.target.value)}
              placeholder="https://example.com/"
              maxLength={4_096}
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            disabled={
              busy || !binding || !newTabUrl.trim() || snapshot?.tabCount === 4
            }
            onClick={openTab}
          >
            <Plus size={12} aria-hidden="true" />
            New tab
          </button>
        </div>
        <div className="browser-takeover-mode" role="group" aria-label="Action">
          {(["click", "type", "select"] as const).map((action) => (
            <button
              type="button"
              className={mode === action ? "is-active" : ""}
              key={action}
              onClick={() => setMode(action)}
            >
              {action}
            </button>
          ))}
        </div>
        <label>
          Fresh ref
          <input
            value={ref}
            onChange={(event) => setRef(event.target.value)}
            placeholder="e6"
            maxLength={40}
          />
        </label>
        {mode !== "click" ? (
          <label>
            {mode === "type" ? "Text" : "Values · one per line"}
            {mode === "type" ? (
              <input
                type="password"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                maxLength={8_000}
                autoComplete="off"
              />
            ) : (
              <textarea
                value={value}
                onChange={(event) => setValue(event.target.value)}
                maxLength={10_240}
              />
            )}
          </label>
        ) : (
          <label className="browser-takeover-checkbox">
            <input
              type="checkbox"
              checked={allowCrossOrigin}
              onChange={(event) => setAllowCrossOrigin(event.target.checked)}
            />
            Allow one cross-origin navigation
          </label>
        )}
        <button
          className="browser-takeover-primary"
          type="button"
          disabled={busy || !binding || !ref.trim()}
          onClick={submitTargetAction}
        >
          <MousePointerClick size={12} aria-hidden="true" />
          Execute once
        </button>
      </div>

      <div className="browser-takeover-quick">
        <label className="browser-takeover-key">
          Navigation key
          <select
            value={selectedKey}
            onChange={(event) =>
              setSelectedKey(event.target.value as BrowserTakeoverKey)
            }
          >
            {BROWSER_TAKEOVER_KEYS.map((key) => (
              <option value={key} key={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !binding}
          onClick={() =>
            binding &&
            void execute({
              ...binding,
              action: "keypress",
              key: selectedKey,
              ...(allowCrossOrigin ? { allowCrossOrigin: true } : {}),
            })
          }
        >
          <Keyboard size={12} aria-hidden="true" />
          Press key
        </button>
        <button
          type="button"
          disabled={busy || !binding}
          onClick={() =>
            binding &&
            void execute({
              ...binding,
              action: "scroll",
              direction: "up",
              pixels: 720,
            })
          }
        >
          <ArrowUp size={12} aria-hidden="true" />
          Scroll up
        </button>
        <button
          type="button"
          disabled={busy || !binding}
          onClick={() =>
            binding &&
            void execute({
              ...binding,
              action: "scroll",
              direction: "down",
              pixels: 720,
            })
          }
        >
          <ArrowDown size={12} aria-hidden="true" />
          Scroll down
        </button>
        <button
          type="button"
          disabled={busy || !binding}
          onClick={() =>
            binding &&
            void execute({
              ...binding,
              action: "back",
              ...(allowCrossOrigin ? { allowCrossOrigin: true } : {}),
            })
          }
        >
          <ArrowLeft size={12} aria-hidden="true" />
          Back
        </button>
        <button
          type="button"
          disabled={busy || !binding}
          onClick={() =>
            binding &&
            void execute({
              ...binding,
              action: "forward",
              ...(allowCrossOrigin ? { allowCrossOrigin: true } : {}),
            })
          }
        >
          <ArrowRight size={12} aria-hidden="true" />
          Forward
        </button>
        <button
          type="button"
          disabled={busy || !binding}
          onClick={() =>
            binding &&
            void execute({ ...binding, action: "wait", durationMs: 1_000 })
          }
        >
          <Clock size={12} aria-hidden="true" />
          Wait 1s
        </button>
      </div>

      <BrowserTakeoverOutput
        binding={binding}
        snapshot={snapshot}
        liveReceipt={liveReceipt}
        targetRef={ref}
        allowCrossOrigin={allowCrossOrigin}
        busy={busy}
        execute={execute}
      />

      <footer>
        <span>
          {receipt
            ? `${receipt.action} · op ${String(receipt.sessionOperation)}`
            : snapshot
              ? `snapshot ${snapshot.snapshotSha256.slice(0, 10)}`
              : "no fresh snapshot"}
        </span>
        {error ? <span role="alert">{error}</span> : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void onReturnToAgent()}
        >
          <Send size={12} aria-hidden="true" />
          Return to Agent
        </button>
      </footer>
    </section>
  );
}

export default BrowserTakeoverDesk;
