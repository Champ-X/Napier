import type {
  BrowserTakeoverActionReceipt,
  BrowserTakeoverSnapshot,
  ExecuteBrowserTakeoverActionRequest,
} from "@napier/contracts/browser-takeover";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Clock,
  MousePointerClick,
  RefreshCw,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { formatApiErrorMessage } from "./api-error";
import {
  executeBrowserTakeoverAction,
  getBrowserTakeoverSnapshot,
} from "./browser-takeover-api";

type TakeoverMode = "click" | "type" | "select";

export function BrowserTakeoverDesk({
  threadId,
  runId,
  onReturnToAgent,
}: {
  threadId: string;
  runId: string;
  onReturnToAgent: () => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<BrowserTakeoverSnapshot>();
  const [receipt, setReceipt] = useState<BrowserTakeoverActionReceipt>();
  const [mode, setMode] = useState<TakeoverMode>("click");
  const [ref, setRef] = useState("");
  const [value, setValue] = useState("");
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
          }
        : undefined,
    [snapshot],
  );

  const execute = useCallback(
    async (request: ExecuteBrowserTakeoverActionRequest) => {
      setBusy(true);
      setError(undefined);
      try {
        setReceipt(await executeBrowserTakeoverAction(threadId, runId, request));
        setRef("");
        setValue("");
        setAllowCrossOrigin(false);
        setSnapshot(await getBrowserTakeoverSnapshot(threadId, runId));
      } catch (actionError) {
        setSnapshot(undefined);
        setError(formatApiErrorMessage(actionError));
      } finally {
        setValue("");
        setBusy(false);
      }
    },
    [runId, threadId],
  );

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

  return (
    <section className="browser-takeover-desk" aria-label="Browser takeover">
      <header>
        <div>
          <span>OPERATOR CONTROL · PAUSE BOUND</span>
          <strong>Take control of this isolated tab</strong>
        </div>
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          <RefreshCw size={12} aria-hidden="true" />
          Fresh refs
        </button>
      </header>

      {snapshot ? (
        <pre aria-label="Untrusted Browser ARIA snapshot">
          {snapshot.snapshot || "(empty page snapshot)"}
        </pre>
      ) : (
        <p className="browser-takeover-empty">
          {busy ? "Reading the paused tab…" : "Refresh to obtain fresh refs."}
        </p>
      )}

      <div className="browser-takeover-controls">
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
            binding && void execute({ ...binding, action: "back" })
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
            void execute({ ...binding, action: "wait", durationMs: 1_000 })
          }
        >
          <Clock size={12} aria-hidden="true" />
          Wait 1s
        </button>
      </div>

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
