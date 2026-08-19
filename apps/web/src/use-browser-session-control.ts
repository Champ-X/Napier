import { useCallback, useEffect, useRef, useState } from "react";

import type { BrowserSessionPauseState } from "@napier/contracts/browser-session-control";
import type { BrowserTakeoverAction } from "@napier/contracts/browser-takeover";

import type { BrowserLiveControlTransition } from "./browser-live-activity";
import {
  getBrowserSessionPauseState,
  pauseBrowserSession,
  resumeBrowserSession,
} from "./browser-session-control-api";

const PAUSE_REFRESH_MS = 1_500;

export interface BrowserSessionControlState {
  pauseState: BrowserSessionPauseState | undefined;
  controlBusy: boolean;
  controlFailed: boolean;
  takeoverOpen: boolean;
  controlTransition: BrowserLiveControlTransition | undefined;
  operatorAction: BrowserTakeoverAction | undefined;
  setOperatorAction: (action: BrowserTakeoverAction | undefined) => void;
  togglePause: () => Promise<void>;
  openTakeover: () => Promise<void>;
  returnToAgent: () => Promise<void>;
}

export function useBrowserSessionControl(threadId: string, runId: string) {
  const [pauseState, setPauseState] = useState<BrowserSessionPauseState>();
  const [controlBusy, setControlBusy] = useState(false);
  const [controlFailed, setControlFailed] = useState(false);
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [controlTransition, setControlTransition] =
    useState<BrowserLiveControlTransition>();
  const [operatorAction, setOperatorAction] = useState<BrowserTakeoverAction>();
  const controlRequestRef = useRef(0);
  const controlBusyRef = useRef(false);
  useBrowserPausePolling(threadId, runId, controlBusyRef, setPauseState);
  const togglePause = useCallback(async () => {
    if (!pauseState || controlBusyRef.current) return;
    const request = (controlRequestRef.current += 1);
    controlBusyRef.current = true;
    setControlBusy(true);
    setControlFailed(false);
    setControlTransition(
      pauseState.status === "paused" ? "resuming" : "pausing",
    );
    try {
      const next = await nextPauseState(threadId, runId, pauseState);
      if (request !== controlRequestRef.current) return;
      setPauseState(next);
      if (next.status !== "paused") setTakeoverOpen(false);
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
    if (pauseState?.status !== "paused") await togglePause();
    setTakeoverOpen(true);
  }, [pauseState?.status, togglePause]);
  const returnToAgent = useCallback(async () => {
    if (pauseState?.status === "paused") await togglePause();
  }, [pauseState?.status, togglePause]);
  const publicState: BrowserSessionControlState = {
    pauseState,
    controlBusy,
    controlFailed,
    takeoverOpen,
    controlTransition,
    operatorAction,
    setOperatorAction,
    togglePause,
    openTakeover,
    returnToAgent,
  };
  return { controlBusyRef, publicState };
}

function useBrowserPausePolling(
  threadId: string,
  runId: string,
  controlBusyRef: { readonly current: boolean },
  setPauseState: (state: BrowserSessionPauseState | undefined) => void,
): void {
  useEffect(() => {
    let active = true;
    const read = () =>
      getBrowserSessionPauseState(threadId, runId)
        .then((state) => {
          if (active && !controlBusyRef.current) setPauseState(state);
        })
        .catch(() => active && setPauseState(undefined));
    void read();
    const timer = window.setInterval(() => void read(), PAUSE_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [controlBusyRef, runId, setPauseState, threadId]);
}

function nextPauseState(
  threadId: string,
  runId: string,
  pauseState: BrowserSessionPauseState,
): Promise<BrowserSessionPauseState> {
  return pauseState.status === "paused"
    ? resumeBrowserSession(threadId, runId, {
        expectedPauseStateSha256: pauseState.contentSha256,
      })
    : pauseBrowserSession(threadId, runId);
}
