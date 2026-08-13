import { useEffect } from "react";

import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";

import { getThread, type WebThreadDetail } from "./api";
import { activeRunViewState } from "./active-run-view-state";
import { upsertThread } from "./thread-detail-view-state";

const RECOVERED_RUN_REFRESH_MS = 1_000;

export function useRecoveredActiveRun(
  detail: WebThreadDetail | undefined,
  streamAttached: boolean,
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
        setDetail(refreshed);
        setBootstrap((current) =>
          current
            ? {
                ...current,
                threads: upsertThread(current.threads, refreshed.thread),
                activeThread: refreshed,
              }
            : current,
        );
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
  }, [setBootstrap, setDetail, state.activeRunId, streamAttached, threadId]);
}
