import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import type { ThreadDetail } from "@napier/contracts";
import { useNewThread } from "./use-new-thread";
import { useSelectThread } from "./use-select-thread";
import { useThreadTrash } from "./use-thread-trash";

export function useThreadNavigation(input: {
  bootstrap: LiveReadyBootstrapResponse | undefined;
  selectedThreadId: string | undefined;
  setBootstrap(value: LiveReadyBootstrapResponse): void;
  setDetail(value: ThreadDetail | undefined): void;
  setSelectedThreadId(value: string | undefined): void;
  setSelectedModelKey(value: string): void;
  modelKey(model: { provider: string; id: string }): string;
  resetReceipts(): void;
  resolveDetail(detail: ThreadDetail | undefined): ThreadDetail | undefined;
  setError(value: string | undefined): void;
}) {
  const shared = {
    setBootstrap: input.setBootstrap,
    setDetail: input.setDetail,
    setSelectedThreadId: input.setSelectedThreadId,
    setSelectedModelKey: input.setSelectedModelKey,
    modelKey: input.modelKey,
    resetReceipts: input.resetReceipts,
    resolveDetail: input.resolveDetail,
    setError: input.setError,
  };
  return {
    selectThread: useSelectThread(shared),
    newThread: useNewThread(shared),
    ...useThreadTrash({
      bootstrap: input.bootstrap,
      selectedThreadId: input.selectedThreadId,
      setBootstrap: input.setBootstrap,
      setDetail: input.setDetail,
      setSelectedThreadId: input.setSelectedThreadId,
      setSelectedModelKey: input.setSelectedModelKey,
      modelKey: input.modelKey,
      setError: input.setError,
    }),
  };
}
