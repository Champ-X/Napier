import { useCallback, useState } from "react";

import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import { createThread, type WebThreadDetail } from "./api";
import { formatApiErrorMessage } from "./api-error";
import { commitThreadLocation } from "./thread-location";
import { activateThreadDetail } from "./thread-run-stream-state";

export function useNewThread(input: {
  bootstrap: LiveReadyBootstrapResponse | undefined;
  setBootstrap(value: LiveReadyBootstrapResponse): void;
  setDetail(value: WebThreadDetail | undefined): void;
  setSelectedThreadId(value: string | undefined): void;
  setSelectedModelKey(value: string): void;
  modelKey(model: { provider: string; id: string }): string;
  resetReceipts(): void;
  resolveDetail(
    detail: WebThreadDetail | undefined,
  ): WebThreadDetail | undefined;
  setError(value: string | undefined): void;
}) {
  const {
    bootstrap,
    modelKey,
    resetReceipts,
    resolveDetail,
    setBootstrap,
    setDetail,
    setError,
    setSelectedModelKey,
    setSelectedThreadId,
  } = input;
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const newThread = useCallback(async () => {
    if (!bootstrap || isCreatingThread) return;
    resetReceipts();
    setError(undefined);
    setIsCreatingThread(true);
    try {
      const response = await createThread();
      const created = resolveDetail(response) ?? response;
      setBootstrap(activateThreadDetail(bootstrap, created));
      setDetail(created);
      commitThreadLocation(setSelectedThreadId, created.thread.id);
      setSelectedModelKey(modelKey(bootstrap.recommendedRunModel));
    } catch (error) {
      setError(formatApiErrorMessage(error));
    } finally {
      setIsCreatingThread(false);
    }
  }, [
    bootstrap,
    isCreatingThread,
    modelKey,
    resetReceipts,
    resolveDetail,
    setBootstrap,
    setDetail,
    setError,
    setSelectedModelKey,
    setSelectedThreadId,
  ]);

  return { isCreatingThread, newThread };
}
