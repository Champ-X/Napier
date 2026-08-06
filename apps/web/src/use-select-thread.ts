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
  setStreamingText(value: string): void;
  setError(value: string | undefined): void;
}) {
  return async (threadId: string) => {
    input.setSelectedThreadId(threadId);
    input.setStreamingText("");
    input.resetReceipts();
    input.setError(undefined);
    try {
      const selected = await getBootstrap(threadId);
      input.setBootstrap(selected);
      input.setDetail(selected.activeThread);
      input.setSelectedModelKey(input.modelKey(selected.recommendedRunModel));
    } catch (error) {
      input.setError(formatApiErrorMessage(error));
    }
  };
}
