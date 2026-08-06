import { useCallback, useState } from "react";

import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import type { ThreadDetail } from "@napier/contracts";
import { getBootstrap } from "./bootstrap-api";
import { formatApiErrorMessage } from "./api-error";
import { restoreThread, trashThread } from "./thread-lifecycle-api";

export interface TrashedThreadReceipt {
  threadId: string;
  title: string;
  trashedAt: string;
}

export function useThreadTrash(input: {
  bootstrap: LiveReadyBootstrapResponse | undefined;
  selectedThreadId: string | undefined;
  setBootstrap(value: LiveReadyBootstrapResponse): void;
  setDetail(value: ThreadDetail | undefined): void;
  setSelectedThreadId(value: string | undefined): void;
  setSelectedModelKey(value: string): void;
  modelKey(model: { provider: string; id: string }): string;
  setError(value: string | undefined): void;
}) {
  const {
    bootstrap,
    selectedThreadId,
    setBootstrap,
    setDetail,
    setSelectedThreadId,
    setSelectedModelKey,
    modelKey,
    setError,
  } = input;
  const [busyThreadId, setBusyThreadId] = useState<string>();
  const [receipt, setReceipt] = useState<TrashedThreadReceipt>();

  const applyBootstrap = useCallback(
    (bootstrap: LiveReadyBootstrapResponse) => {
      setBootstrap(bootstrap);
      setDetail(bootstrap.activeThread);
      setSelectedThreadId(bootstrap.activeThread?.thread.id);
      setSelectedModelKey(modelKey(bootstrap.recommendedRunModel));
    },
    [
      modelKey,
      setBootstrap,
      setDetail,
      setSelectedModelKey,
      setSelectedThreadId,
    ],
  );

  const trash = useCallback(
    async (threadId: string) => {
      if (!bootstrap || busyThreadId) return;
      const target = bootstrap.threads.find((thread) => thread.id === threadId);
      if (!target) return;
      setBusyThreadId(threadId);
      setError(undefined);
      try {
        await trashThread(threadId);
        const remaining = bootstrap.threads.filter(
          (thread) => thread.id !== threadId,
        );
        const nextThreadId =
          threadId === selectedThreadId ? remaining[0]?.id : selectedThreadId;
        applyBootstrap(await getBootstrap(nextThreadId));
        setReceipt({
          threadId,
          title: target.title,
          trashedAt: new Date().toISOString(),
        });
      } catch (error) {
        setError(formatApiErrorMessage(error));
      } finally {
        setBusyThreadId(undefined);
      }
    },
    [applyBootstrap, bootstrap, busyThreadId, selectedThreadId, setError],
  );

  const restore = useCallback(async () => {
    if (!receipt || busyThreadId) return;
    setBusyThreadId(receipt.threadId);
    setError(undefined);
    try {
      await restoreThread(receipt.threadId);
      applyBootstrap(await getBootstrap(receipt.threadId));
      setReceipt(undefined);
    } catch (error) {
      setError(formatApiErrorMessage(error));
    } finally {
      setBusyThreadId(undefined);
    }
  }, [applyBootstrap, busyThreadId, receipt, setError]);

  return {
    threadLifecycleBusyId: busyThreadId,
    trashedThreadReceipt: receipt,
    trashThread: trash,
    restoreTrashedThread: restore,
  };
}
