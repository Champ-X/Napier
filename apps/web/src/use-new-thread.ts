import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import type { ThreadDetail } from "@napier/contracts";
import { createThread } from "./api";
import { getBootstrap } from "./bootstrap-api";
import { formatApiErrorMessage } from "./api-error";

export function useNewThread(input: {
  setBootstrap(value: LiveReadyBootstrapResponse): void;
  setDetail(value: ThreadDetail | undefined): void;
  setSelectedThreadId(value: string | undefined): void;
  setSelectedModelKey(value: string): void;
  modelKey(model: { provider: string; id: string }): string;
  resetReceipts(): void;
  setError(value: string | undefined): void;
}) {
  return async () => {
    input.resetReceipts();
    input.setError(undefined);
    try {
      const created = await createThread();
      const refreshed = await getBootstrap(created.thread.id);
      input.setBootstrap(refreshed);
      input.setDetail(refreshed.activeThread);
      input.setSelectedThreadId(created.thread.id);
      input.setSelectedModelKey(input.modelKey(refreshed.recommendedRunModel));
    } catch (error) {
      input.setError(formatApiErrorMessage(error));
    }
  };
}
