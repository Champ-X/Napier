import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import type { BrowserSessionPauseState } from "@napier/contracts/browser-session-control";
import type { BrowserTakeoverAction } from "@napier/contracts/browser-takeover";

import { getBrowserLiveView } from "./browser-live-view-api";
import type { BrowserLiveViewStreamImage } from "./browser-live-view-stream-api";
import type { BrowserLiveControlTransition } from "./browser-live-activity";
import { useBrowserSessionControl } from "./use-browser-session-control";

type BrowserLiveImage =
  | BrowserLiveViewStreamImage
  | Awaited<ReturnType<typeof getBrowserLiveView>>;

export interface BrowserLiveViewController {
  imageUrl: string | undefined;
  receipt: BrowserLiveViewReceipt | undefined;
  refreshing: boolean;
  manualRefresh: () => Promise<void>;
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

export function useBrowserLiveViewController(
  threadId: string,
  runId: string,
): BrowserLiveViewController {
  const session = useBrowserSessionControl(threadId, runId);
  const live = useBrowserLiveImageController(
    threadId,
    runId,
    session.controlBusyRef,
  );
  return { ...live, ...session.publicState };
}

function useBrowserLiveImageController(
  threadId: string,
  runId: string,
  controlBusyRef: { readonly current: boolean },
) {
  const [imageUrl, setImageUrl] = useState<string>();
  const [receipt, setReceipt] = useState<BrowserLiveViewReceipt>();
  const [refreshing, setRefreshing] = useState(false);
  const [streamRevision, setStreamRevision] = useState(0);
  const requestRef = useRef(0);
  const imageUrlRef = useRef<string | undefined>(undefined);
  const refreshControllerRef = useRef<AbortController | undefined>(undefined);
  const streamControllerRef = useRef<AbortController | undefined>(undefined);
  const clearLive = useCallback(() => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    imageUrlRef.current = undefined;
    setImageUrl(undefined);
    setReceipt(undefined);
  }, []);
  const applyLive = useCallback((live: BrowserLiveImage) => {
    const nextUrl = URL.createObjectURL(live.blob);
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    imageUrlRef.current = nextUrl;
    setImageUrl(nextUrl);
    setReceipt(live.receipt);
  }, []);
  const refreshOptions = useMemo(
    () => ({
      threadId,
      runId,
      controlBusyRef,
      requestRef,
      refreshControllerRef,
      applyLive,
      clearLive,
      setRefreshing,
    }),
    [applyLive, clearLive, controlBusyRef, runId, threadId],
  );
  const refresh = useBrowserLiveRefresh(refreshOptions);
  const manualRefresh = useCallback(async () => {
    streamControllerRef.current?.abort();
    await refresh();
    setStreamRevision((revision) => revision + 1);
  }, [refresh]);
  const streamOptions = useMemo(
    () => ({
      threadId,
      runId,
      streamRevision,
      streamControllerRef,
      refreshControllerRef,
      requestRef,
      applyLive,
      clearLive,
      refresh,
    }),
    [applyLive, clearLive, refresh, runId, streamRevision, threadId],
  );
  useBrowserLiveStream(streamOptions);
  useEffect(
    () => () => {
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = undefined;
    },
    [],
  );
  return { imageUrl, receipt, refreshing, manualRefresh };
}

interface BrowserLiveRefreshOptions {
  threadId: string;
  runId: string;
  controlBusyRef: { readonly current: boolean };
  requestRef: { current: number };
  refreshControllerRef: { current: AbortController | undefined };
  applyLive: (live: BrowserLiveImage) => void;
  clearLive: () => void;
  setRefreshing: (refreshing: boolean) => void;
}

function useBrowserLiveRefresh(options: BrowserLiveRefreshOptions) {
  return useCallback(async () => {
    if (options.controlBusyRef.current) return;
    const request = (options.requestRef.current += 1);
    options.refreshControllerRef.current?.abort();
    const controller = new AbortController();
    options.refreshControllerRef.current = controller;
    options.setRefreshing(true);
    try {
      const live = await getBrowserLiveView(
        options.threadId,
        options.runId,
        controller.signal,
      );
      if (request === options.requestRef.current) options.applyLive(live);
    } catch {
      if (request === options.requestRef.current) options.clearLive();
    } finally {
      if (request === options.requestRef.current) {
        options.refreshControllerRef.current = undefined;
        options.setRefreshing(false);
      }
    }
  }, [options]);
}

interface BrowserLiveStreamOptions {
  threadId: string;
  runId: string;
  streamRevision: number;
  streamControllerRef: { current: AbortController | undefined };
  refreshControllerRef: { current: AbortController | undefined };
  requestRef: { current: number };
  applyLive: (live: BrowserLiveImage) => void;
  clearLive: () => void;
  refresh: () => Promise<void>;
}

function useBrowserLiveStream(options: BrowserLiveStreamOptions): void {
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    options.streamControllerRef.current = controller;
    void streamUntilTerminal(options, controller, () => active);
    return () => {
      active = false;
      controller.abort();
      if (options.streamControllerRef.current === controller) {
        options.streamControllerRef.current = undefined;
      }
      options.requestRef.current += 1;
      options.refreshControllerRef.current?.abort();
      options.refreshControllerRef.current = undefined;
    };
  }, [options]);
}

async function streamUntilTerminal(
  options: BrowserLiveStreamOptions,
  controller: AbortController,
  isActive: () => boolean,
): Promise<void> {
  try {
    const { streamBrowserLiveViews } =
      await import("./browser-live-view-stream-api");
    for (;;) {
      const terminal = await streamBrowserLiveViews(
        options.threadId,
        options.runId,
        (live) => isActive() && options.applyLive(live),
        controller.signal,
      );
      if (!isActive() || terminal.reason !== "sample_limit") {
        if (isActive() && terminal.reason === "session_ended") {
          options.clearLive();
        }
        break;
      }
    }
  } catch {
    if (isActive() && !controller.signal.aborted) await options.refresh();
  }
}
