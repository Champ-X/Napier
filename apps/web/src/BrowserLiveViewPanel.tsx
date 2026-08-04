import { Eye, Pause, Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import type { BrowserSessionPauseState } from "@napier/contracts/browser-session-control";

import { getBrowserLiveView } from "./browser-live-view-api";
import {
  getBrowserSessionPauseState,
  pauseBrowserSession,
  resumeBrowserSession,
} from "./browser-session-control-api";

const REFRESH_MS = 1_500;

export function BrowserLiveViewPanel({
  threadId,
  runId,
}: {
  threadId: string;
  runId: string;
}) {
  const [imageUrl, setImageUrl] = useState<string>();
  const [receipt, setReceipt] = useState<BrowserLiveViewReceipt>();
  const [pauseState, setPauseState] = useState<BrowserSessionPauseState>();
  const [available, setAvailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [controlFailed, setControlFailed] = useState(false);
  const requestRef = useRef(0);
  const controlRequestRef = useRef(0);
  const controlBusyRef = useRef(false);
  const imageUrlRef = useRef<string | undefined>(undefined);
  const controllerRef = useRef<AbortController | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (controlBusyRef.current) return;
    const request = (requestRef.current += 1);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setRefreshing(true);
    try {
      const [live, nextPauseState] = await Promise.all([
        getBrowserLiveView(threadId, runId, controller.signal),
        getBrowserSessionPauseState(threadId, runId),
      ]);
      if (request !== requestRef.current) return;
      const nextUrl = URL.createObjectURL(live.blob);
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = nextUrl;
      setImageUrl(nextUrl);
      setReceipt(live.receipt);
      setPauseState(nextPauseState);
      setAvailable(true);
    } catch {
      if (request !== requestRef.current) return;
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = undefined;
      setImageUrl(undefined);
      setReceipt(undefined);
      setPauseState(undefined);
      setAvailable(false);
    } finally {
      if (request === requestRef.current) {
        controllerRef.current = undefined;
        setRefreshing(false);
      }
    }
  }, [runId, threadId]);

  const togglePause = useCallback(async () => {
    if (!pauseState || controlBusyRef.current) return;
    const request = (controlRequestRef.current += 1);
    requestRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = undefined;
    controlBusyRef.current = true;
    setControlBusy(true);
    setControlFailed(false);
    try {
      const nextState =
        pauseState.status === "paused"
          ? await resumeBrowserSession(threadId, runId, {
              expectedPauseStateSha256: pauseState.contentSha256,
            })
          : await pauseBrowserSession(threadId, runId);
      if (request !== controlRequestRef.current) return;
      setPauseState(nextState);
    } catch {
      if (request === controlRequestRef.current) setControlFailed(true);
    } finally {
      if (request === controlRequestRef.current) {
        controlBusyRef.current = false;
        setControlBusy(false);
      }
    }
  }, [pauseState, runId, threadId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      requestRef.current += 1;
      controlRequestRef.current += 1;
      controlBusyRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = undefined;
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = undefined;
    };
  }, [refresh]);

  if (!available || !imageUrl || !receipt || !pauseState) return null;
  const paused = pauseState.status === "paused";
  return (
    <section
      className={`browser-live-view${paused ? " is-paused" : ""}`}
      aria-label="Browser Live"
    >
      <header>
        <span>
          <Eye size={13} aria-hidden="true" />
          Browser Live
        </span>
        <div className="browser-live-controls">
          <span
            className={`browser-session-state ${paused ? "is-paused" : ""}`}
            aria-live="polite"
          >
            {paused ? "Paused" : "Running"}
          </span>
          <button
            className="browser-session-toggle"
            type="button"
            disabled={controlBusy}
            onClick={() => void togglePause()}
            title={
              paused
                ? "Allow the next Browser action"
                : "Pause after the current Browser action"
            }
          >
            {paused ? (
              <Play size={12} aria-hidden="true" />
            ) : (
              <Pause size={12} aria-hidden="true" />
            )}
            {controlBusy ? "Working" : paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw size={12} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </header>
      <img
        src={imageUrl}
        alt="Live viewport from the active isolated Browser Session"
      />
      <footer>
        <span>op {String(receipt.sessionOperation)}</span>
        <span title={receipt.currentOriginSha256}>
          origin {receipt.currentOriginSha256.slice(0, 10)}
        </span>
        <span>{new Date(receipt.capturedAt).toLocaleTimeString()}</span>
        {controlFailed ? <span>control retry required</span> : null}
      </footer>
    </section>
  );
}
