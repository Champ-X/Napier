import { Eye, Pause, Play, RefreshCw, ShieldAlert } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import type { RunEvent } from "@napier/contracts";
import type { BrowserInteractionAction } from "@napier/contracts/browser-interaction-confirmation";
import type { BrowserSessionPauseState } from "@napier/contracts/browser-session-control";
import type { BrowserTakeoverAction } from "@napier/contracts/browser-takeover";

import { getBrowserLiveView } from "./browser-live-view-api";
import type { BrowserLiveViewStreamImage } from "./browser-live-view-stream-api";
import {
  browserLiveActivity,
  type BrowserLiveControlTransition,
} from "./browser-live-activity";
import {
  getBrowserSessionPauseState,
  pauseBrowserSession,
  resumeBrowserSession,
} from "./browser-session-control-api";

const PAUSE_REFRESH_MS = 1_500;
const LazyBrowserTakeoverDesk = lazy(() => import("./BrowserTakeoverDesk"));

export function BrowserLiveViewPanel({
  threadId,
  runId,
  events,
  confirmationAction,
}: {
  threadId: string;
  runId: string;
  events: readonly RunEvent[];
  confirmationAction?: BrowserInteractionAction;
}) {
  const [imageUrl, setImageUrl] = useState<string>();
  const [receipt, setReceipt] = useState<BrowserLiveViewReceipt>();
  const [pauseState, setPauseState] = useState<BrowserSessionPauseState>();
  const [available, setAvailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [controlFailed, setControlFailed] = useState(false);
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [controlTransition, setControlTransition] =
    useState<BrowserLiveControlTransition>();
  const [operatorAction, setOperatorAction] = useState<BrowserTakeoverAction>();
  const [streamRevision, setStreamRevision] = useState(0);
  const requestRef = useRef(0);
  const controlRequestRef = useRef(0);
  const controlBusyRef = useRef(false);
  const imageUrlRef = useRef<string | undefined>(undefined);
  const refreshControllerRef = useRef<AbortController | undefined>(undefined);
  const streamControllerRef = useRef<AbortController | undefined>(undefined);

  const clearLive = useCallback(() => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    imageUrlRef.current = undefined;
    setImageUrl(undefined);
    setReceipt(undefined);
    setAvailable(false);
  }, []);

  const applyLive = useCallback(
    (
      live:
        | BrowserLiveViewStreamImage
        | Awaited<ReturnType<typeof getBrowserLiveView>>,
    ) => {
      const nextUrl = URL.createObjectURL(live.blob);
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = nextUrl;
      setImageUrl(nextUrl);
      setReceipt(live.receipt);
      setAvailable(true);
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (controlBusyRef.current) return;
    const request = (requestRef.current += 1);
    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    setRefreshing(true);
    try {
      const [live, nextPauseState] = await Promise.all([
        getBrowserLiveView(threadId, runId, controller.signal),
        getBrowserSessionPauseState(threadId, runId),
      ]);
      if (request !== requestRef.current) return;
      applyLive(live);
      setPauseState(nextPauseState);
    } catch {
      if (request !== requestRef.current) return;
      clearLive();
      setPauseState(undefined);
    } finally {
      if (request === requestRef.current) {
        refreshControllerRef.current = undefined;
        setRefreshing(false);
      }
    }
  }, [applyLive, clearLive, runId, threadId]);

  const manualRefresh = useCallback(async () => {
    streamControllerRef.current?.abort();
    await refresh();
    setStreamRevision((revision) => revision + 1);
  }, [refresh]);

  const togglePause = useCallback(async () => {
    if (!pauseState || controlBusyRef.current) return;
    const request = (controlRequestRef.current += 1);
    requestRef.current += 1;
    refreshControllerRef.current?.abort();
    refreshControllerRef.current = undefined;
    controlBusyRef.current = true;
    setControlBusy(true);
    setControlFailed(false);
    setControlTransition(
      pauseState.status === "paused" ? "resuming" : "pausing",
    );
    try {
      const nextState =
        pauseState.status === "paused"
          ? await resumeBrowserSession(threadId, runId, {
              expectedPauseStateSha256: pauseState.contentSha256,
            })
          : await pauseBrowserSession(threadId, runId);
      if (request !== controlRequestRef.current) return;
      setPauseState(nextState);
      if (nextState.status !== "paused") setTakeoverOpen(false);
    } catch {
      if (request === controlRequestRef.current) setControlFailed(true);
    } finally {
      if (request === controlRequestRef.current) {
        controlBusyRef.current = false;
        setControlBusy(false);
        setControlTransition(undefined);
      }
    }
  }, [pauseState, runId, threadId]);

  const openTakeover = useCallback(async () => {
    if (controlBusyRef.current) return;
    if (pauseState?.status !== "paused") {
      await togglePause();
    }
    setTakeoverOpen(true);
  }, [pauseState?.status, togglePause]);

  const returnToAgent = useCallback(async () => {
    if (pauseState?.status !== "paused") return;
    await togglePause();
  }, [pauseState?.status, togglePause]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    streamControllerRef.current = controller;
    void getBrowserSessionPauseState(threadId, runId)
      .then(
        (state) => active && !controlBusyRef.current && setPauseState(state),
      )
      .catch(() => active && setPauseState(undefined));
    const timer = window.setInterval(() => {
      void getBrowserSessionPauseState(threadId, runId)
        .then(
          (state) => active && !controlBusyRef.current && setPauseState(state),
        )
        .catch(() => undefined);
    }, PAUSE_REFRESH_MS);
    void (async () => {
      try {
        const { streamBrowserLiveViews } =
          await import("./browser-live-view-stream-api");
        for (;;) {
          const terminal = await streamBrowserLiveViews(
            threadId,
            runId,
            (live) => {
              if (active) applyLive(live);
            },
            controller.signal,
          );
          if (!active || terminal.reason !== "sample_limit") {
            if (active && terminal.reason === "session_ended") {
              clearLive();
            }
            break;
          }
        }
      } catch {
        if (active && !controller.signal.aborted) await refresh();
      }
    })();
    return () => {
      active = false;
      window.clearInterval(timer);
      controller.abort();
      if (streamControllerRef.current === controller) {
        streamControllerRef.current = undefined;
      }
      requestRef.current += 1;
      controlRequestRef.current += 1;
      controlBusyRef.current = false;
      setControlTransition(undefined);
      setOperatorAction(undefined);
      refreshControllerRef.current?.abort();
      refreshControllerRef.current = undefined;
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = undefined;
    };
  }, [applyLive, clearLive, refresh, runId, streamRevision, threadId]);

  if (!available || !imageUrl || !receipt || !pauseState) return null;
  const paused = pauseState.status === "paused";
  const diagnosis = receipt.pageDiagnosis.status;
  const diagnosisActive = diagnosis !== "none";
  const activity = browserLiveActivity(events, runId, {
    pauseStatus: pauseState.status,
    takeoverOpen: paused && takeoverOpen,
    ...(controlTransition ? { controlTransition } : {}),
    ...(confirmationAction ? { confirmationAction } : {}),
    ...(operatorAction ? { operatorAction } : {}),
  });
  return (
    <section
      className={`browser-live-view${paused ? " is-paused" : ""}${paused && takeoverOpen ? " has-takeover" : ""}${diagnosisActive ? " has-diagnosis" : ""}`}
      aria-label="Browser Live"
      tabIndex={-1}
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
            disabled={controlBusy}
            onClick={() => void openTakeover()}
          >
            Take control
          </button>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void manualRefresh()}
          >
            <RefreshCw size={12} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </header>
      <div
        className={`browser-live-activity is-${activity.state}`}
        role="status"
        aria-live="polite"
      >
        <span>{activity.label}</span>
      </div>
      {diagnosisActive ? (
        <div
          className="browser-page-diagnosis"
          role="status"
          aria-live="polite"
        >
          <ShieldAlert size={16} aria-hidden="true" />
          <div>
            <strong>
              {diagnosis === "challenge_detected"
                ? "Human verification required"
                : "Login required"}
            </strong>
            <span>
              Continue privately in this isolated Browser profile. Napier does
              not solve CAPTCHAs or import existing Chrome login state.
            </span>
          </div>
          <button
            type="button"
            disabled={controlBusy}
            onClick={() => void openTakeover()}
          >
            Take control
          </button>
        </div>
      ) : null}
      <img
        src={imageUrl}
        alt="Live viewport from the active isolated Browser Session"
      />
      {paused && takeoverOpen ? (
        <Suspense
          fallback={
            <div className="browser-takeover-loading" role="status">
              Opening operator controls…
            </div>
          }
        >
          <LazyBrowserTakeoverDesk
            threadId={threadId}
            runId={runId}
            liveImageUrl={imageUrl}
            liveReceipt={receipt}
            onActivityChange={setOperatorAction}
            onReturnToAgent={returnToAgent}
          />
        </Suspense>
      ) : null}
      <footer>
        <span>op {String(receipt.sessionOperation)}</span>
        <span>
          {receipt.activeTabId} · {String(receipt.tabCount)} tab
          {receipt.tabCount === 1 ? "" : "s"}
        </span>
        <span title={receipt.currentOriginSha256}>
          origin {receipt.currentOriginSha256.slice(0, 10)}
        </span>
        <span>{new Date(receipt.capturedAt).toLocaleTimeString()}</span>
        {controlFailed ? <span>control retry required</span> : null}
      </footer>
    </section>
  );
}
