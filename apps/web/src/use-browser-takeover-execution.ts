import { useCallback } from "react";

import type {
  BrowserTakeoverAction,
  BrowserTakeoverActionReceipt,
  ExecuteBrowserTakeoverActionRequest,
} from "@napier/contracts/browser-takeover";

import { formatApiErrorMessage } from "./api-error";
import {
  executeBrowserTakeoverAction,
  getBrowserTakeoverSnapshot,
} from "./browser-takeover-api";

export function useBrowserTakeoverExecution(input: {
  threadId: string;
  runId: string;
  onActivityChange: (action: BrowserTakeoverAction | undefined) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | undefined) => void;
  setReceipt: (receipt: BrowserTakeoverActionReceipt) => void;
  setSnapshot: (
    snapshot:
      | Awaited<ReturnType<typeof getBrowserTakeoverSnapshot>>
      | undefined,
  ) => void;
  clearPrivateState: () => void;
}) {
  return useCallback(
    async (request: ExecuteBrowserTakeoverActionRequest) => {
      input.setBusy(true);
      input.setError(undefined);
      input.onActivityChange(request.action);
      try {
        const completed = await executeBrowserTakeoverAction(
          input.threadId,
          input.runId,
          request,
        );
        input.setReceipt(completed);
        input.clearPrivateState();
        input.setSnapshot(
          await getBrowserTakeoverSnapshot(input.threadId, input.runId),
        );
        return completed;
      } catch (actionError) {
        input.setSnapshot(undefined);
        input.setError(formatApiErrorMessage(actionError));
        return undefined;
      } finally {
        input.clearPrivateState();
        input.setBusy(false);
        input.onActivityChange(undefined);
      }
    },
    [input],
  );
}
