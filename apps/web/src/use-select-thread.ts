import { useRef } from "react";

import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import type { ThreadDetail } from "@napier/contracts";
import { getBootstrap } from "./bootstrap-api";
import { formatApiErrorMessage } from "./api-error";

export function useSelectThread(input: {
  setBootstrap(value: LiveReadyBootstrapResponse): void;
  setDetail(value: ThreadDetail | undefined): void;
  setSelectedThreadId(value: string | undefined): void;
  setSelectedModelKey(value: string): void;
  modelKey(model: { provider: string; id: string }): string;
  resetReceipts(): void;
  resolveDetail(detail: ThreadDetail | undefined): ThreadDetail | undefined;
  setError(value: string | undefined): void;
}) {
  const requestIdRef = useRef(0);
  return async (threadId: string) => {
    const requestId = ++requestIdRef.current;
    input.setSelectedThreadId(threadId);
    input.resetReceipts();
    input.setError(undefined);
    try {
      const selected = await getBootstrap(threadId);
      if (requestId !== requestIdRef.current) return;
      const activeThread = input.resolveDetail(selected.activeThread);
      input.setBootstrap({
        ...selected,
        ...(activeThread ? { activeThread } : {}),
      });
      input.setDetail(activeThread);
      input.setSelectedModelKey(input.modelKey(selected.recommendedRunModel));
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      input.setError(formatApiErrorMessage(error));
    }
  };
}
