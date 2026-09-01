import { useCallback, useEffect, useState } from "react";

import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import { getThread, type WebThreadDetail } from "./api";
import { formatApiErrorMessage } from "./api-error";
import { commitThreadLocation } from "./thread-location";
import { restoreThread, trashThread } from "./thread-lifecycle-api";
import {
  activateThreadDetail,
  removeThreadDetail,
} from "./thread-run-stream-state";

export interface TrashedThreadReceipt {
  threadId: string;
  title: string;
  trashedAt: string;
}

export const THREAD_UNDO_WINDOW_MS = 5_000;

export function useThreadTrash(input: {
  bootstrap: LiveReadyBootstrapResponse | undefined;
  detail: WebThreadDetail | undefined;
  selectedThreadId: string | undefined;
  setBootstrap(value: LiveReadyBootstrapResponse): void;
  setDetail(value: WebThreadDetail | undefined): void;
  setSelectedThreadId(value: string | undefined): void;
  setSelectedModelKey(value: string): void;
  modelKey(model: { provider: string; id: string }): string;
  cachedDetail(threadId: string): WebThreadDetail | undefined;
  resolveDetail(
    detail: WebThreadDetail | undefined,
  ): WebThreadDetail | undefined;
  setError(value: string | undefined): void;
}) {
  const {
    bootstrap,
    cachedDetail,
    detail,
    modelKey,
    resolveDetail,
    selectedThreadId,
    setBootstrap,
    setDetail,
    setError,
    setSelectedModelKey,
    setSelectedThreadId,
  } = input;
  const [busyThreadId, setBusyThreadId] = useState<string>();
  const [receipt, setReceipt] = useState<TrashedThreadReceipt>();

  useEffect(() => {
    if (!receipt) return;
    const timeout = window.setTimeout(
      () => setReceipt(undefined),
      THREAD_UNDO_WINDOW_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [receipt]);

  const trash = useCallback(
    async (threadId: string) => {
      if (!bootstrap || busyThreadId) return;
      const target = bootstrap.threads.find((thread) => thread.id === threadId);
      if (!target) return;
      const previousDetail = detail;
      const previousSelectedThreadId = selectedThreadId;
      const remaining = bootstrap.threads.filter(
        (thread) => thread.id !== threadId,
      );
      const activeRemoved = threadId === selectedThreadId;
      const nextThreadId = activeRemoved ? remaining[0]?.id : selectedThreadId;
      const cachedNext = nextThreadId ? cachedDetail(nextThreadId) : undefined;
      const optimistic = removeThreadDetail(
        bootstrap,
        threadId,
        activeRemoved ? cachedNext : undefined,
      );

      setBusyThreadId(threadId);
      setError(undefined);
      setBootstrap(optimistic);
      if (activeRemoved) {
        setDetail(cachedNext);
        commitThreadLocation(setSelectedThreadId, nextThreadId);
      }
      try {
        await trashThread(threadId);
        if (activeRemoved && nextThreadId) {
          const response = await getThread(nextThreadId);
          const next = resolveDetail(response) ?? response;
          setBootstrap(activateThreadDetail(optimistic, next));
          setDetail(next);
          commitThreadLocation(setSelectedThreadId, next.thread.id);
        }
        setReceipt({
          threadId,
          title: target.title,
          trashedAt: new Date().toISOString(),
        });
      } catch (error) {
        setBootstrap(bootstrap);
        setDetail(previousDetail);
        commitThreadLocation(setSelectedThreadId, previousSelectedThreadId);
        setError(formatApiErrorMessage(error));
      } finally {
        setBusyThreadId(undefined);
      }
    },
    [
      bootstrap,
      busyThreadId,
      cachedDetail,
      detail,
      resolveDetail,
      selectedThreadId,
      setBootstrap,
      setDetail,
      setError,
      setSelectedThreadId,
    ],
  );

  const restore = useCallback(async () => {
    if (!bootstrap || !receipt || busyThreadId) return;
    setBusyThreadId(receipt.threadId);
    setError(undefined);
    try {
      const response = await restoreThread(receipt.threadId);
      const restored = resolveDetail(response) ?? response;
      setBootstrap(activateThreadDetail(bootstrap, restored));
      setDetail(restored);
      commitThreadLocation(setSelectedThreadId, restored.thread.id);
      setSelectedModelKey(modelKey(bootstrap.recommendedRunModel));
      setReceipt(undefined);
    } catch (error) {
      setError(formatApiErrorMessage(error));
    } finally {
      setBusyThreadId(undefined);
    }
  }, [
    bootstrap,
    busyThreadId,
    modelKey,
    receipt,
    resolveDetail,
    setBootstrap,
    setDetail,
    setError,
    setSelectedModelKey,
    setSelectedThreadId,
  ]);

  return {
    threadLifecycleBusyId: busyThreadId,
    trashedThreadReceipt: receipt,
    trashThread: trash,
    restoreTrashedThread: restore,
  };
}
