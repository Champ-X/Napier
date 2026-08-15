import { useEffect, type RefObject } from "react";

import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";

import { getThread, type WebThreadDetail } from "./api";
import { activeRunViewState } from "./active-run-view-state";
import { mergeBackgroundThreadDetail } from "./thread-run-stream-state";

const RECOVERED_RUN_REFRESH_MS = 1_000;

export function useRecoveredActiveRun(
  detail: WebThreadDetail | undefined,
  streamAttached: boolean,
  selectedThreadIdRef: RefObject<string | undefined>,
  setDetail: (detail: WebThreadDetail) => void,
  setBootstrap: (
    update: (
      current: LiveReadyBootstrapResponse | undefined,
    ) => LiveReadyBootstrapResponse | undefined,
  ) => void,
): void {
  const state = activeRunViewState(detail);
  const threadId = detail?.thread.id;
  useEffect(() => {
    if (streamAttached) return;
    if (!state.activeRunId || !threadId) return;

    let disposed = false;
    const refresh = async () => {
      try {
        const refreshed = await getThread(threadId);
        if (disposed) return;
        setBootstrap((current) =>
          mergeBackgroundThreadDetail(current, refreshed),
        );
        if (selectedThreadIdRef.current === threadId) setDetail(refreshed);
      } catch {}
    };
    const timer = window.setInterval(
      () => void refresh(),
      RECOVERED_RUN_REFRESH_MS,
    );
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [
    selectedThreadIdRef,
    setBootstrap,
    setDetail,
    state.activeRunId,
    streamAttached,
    threadId,
  ]);
}
