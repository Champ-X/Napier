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

    const controller = new AbortController();
    let timer: number | undefined;
    const refresh = async (): Promise<void> => {
      try {
        const refreshed = await getThread(threadId, controller.signal);
        if (controller.signal.aborted) return;
        setBootstrap((current) =>
          mergeBackgroundThreadDetail(current, refreshed),
        );
        if (selectedThreadIdRef.current === threadId) setDetail(refreshed);
      } catch {
        // Retry after settle; abort ends the loop.
      } finally {
        if (!controller.signal.aborted) {
          timer = window.setTimeout(() => void refresh(), RECOVERED_RUN_REFRESH_MS);
        }
      }
    };
    timer = window.setTimeout(() => void refresh(), RECOVERED_RUN_REFRESH_MS);
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
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
