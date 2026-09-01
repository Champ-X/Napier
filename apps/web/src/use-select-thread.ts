import { useCallback, useRef } from "react";

import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import { getThread, type WebThreadDetail } from "./api";
import { formatApiErrorMessage } from "./api-error";
import { commitThreadLocation } from "./thread-location";
import { activateThreadDetail } from "./thread-run-stream-state";

export function useSelectThread(input: {
  bootstrap: LiveReadyBootstrapResponse | undefined;
  detail: WebThreadDetail | undefined;
  selectedThreadId: string | undefined;
  setBootstrap(value: LiveReadyBootstrapResponse): void;
  setDetail(value: WebThreadDetail | undefined): void;
  setSelectedThreadId(value: string | undefined): void;
  setSelectedModelKey(value: string): void;
  modelKey(model: { provider: string; id: string }): string;
  resetReceipts(): void;
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
    resetReceipts,
    resolveDetail,
    selectedThreadId,
    setBootstrap,
    setDetail,
    setError,
    setSelectedModelKey,
    setSelectedThreadId,
  } = input;
  const requestIdRef = useRef(0);
  return useCallback(
    async (threadId: string) => {
      if (!bootstrap || threadId === selectedThreadId) return;
      const requestId = ++requestIdRef.current;
      const previousDetail = detail;
      const previousThreadId = selectedThreadId;
      const cached = cachedDetail(threadId);
      commitThreadLocation(setSelectedThreadId, threadId);
      resetReceipts();
      setError(undefined);
      setDetail(cached);
      if (cached) {
        setBootstrap(activateThreadDetail(bootstrap, cached));
      }
      try {
        const response = await getThread(threadId);
        if (requestId !== requestIdRef.current) return;
        const selected = resolveDetail(response) ?? response;
        setBootstrap(activateThreadDetail(bootstrap, selected));
        setDetail(selected);
        commitThreadLocation(setSelectedThreadId, selected.thread.id);
        setSelectedModelKey(modelKey(bootstrap.recommendedRunModel));
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        setError(formatApiErrorMessage(error));
        setDetail(previousDetail);
        if (previousDetail) {
          setBootstrap(activateThreadDetail(bootstrap, previousDetail));
        }
        commitThreadLocation(setSelectedThreadId, previousThreadId);
      }
    },
    [
      bootstrap,
      cachedDetail,
      detail,
      modelKey,
      resetReceipts,
      resolveDetail,
      selectedThreadId,
      setBootstrap,
      setDetail,
      setError,
      setSelectedModelKey,
      setSelectedThreadId,
    ],
  );
}
