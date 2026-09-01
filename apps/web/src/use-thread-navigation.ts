import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import type { WebThreadDetail } from "./api";
import { useNewThread } from "./use-new-thread";
import { useSelectThread } from "./use-select-thread";
import { useThreadTrash } from "./use-thread-trash";

export function useThreadNavigation(input: {
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
  const shared = {
    bootstrap: input.bootstrap,
    detail: input.detail,
    selectedThreadId: input.selectedThreadId,
    setBootstrap: input.setBootstrap,
    setDetail: input.setDetail,
    setSelectedThreadId: input.setSelectedThreadId,
    setSelectedModelKey: input.setSelectedModelKey,
    modelKey: input.modelKey,
    resetReceipts: input.resetReceipts,
    cachedDetail: input.cachedDetail,
    resolveDetail: input.resolveDetail,
    setError: input.setError,
  };
  const selectThread = useSelectThread(shared);
  const newThread = useNewThread(shared);
  return {
    selectThread,
    ...newThread,
    ...useThreadTrash({
      bootstrap: input.bootstrap,
      detail: input.detail,
      selectedThreadId: input.selectedThreadId,
      setBootstrap: input.setBootstrap,
      setDetail: input.setDetail,
      setSelectedThreadId: input.setSelectedThreadId,
      setSelectedModelKey: input.setSelectedModelKey,
      modelKey: input.modelKey,
      cachedDetail: input.cachedDetail,
      resolveDetail: input.resolveDetail,
      setError: input.setError,
    }),
  };
}
