import { useCallback, useRef } from "react";
import type {
  ModelRef,
  RunRecord,
  StreamFrame,
  ThreadDetail,
} from "@napier/contracts";
import { resumeInterruptedRun } from "./thread-run-api";

export interface ThreadRecoveryOptions {
  detail: ThreadDetail | undefined;
  run: RunRecord | undefined;
  running: boolean;
  modelConfigured: boolean;
  model: ModelRef;
  onStart: (threadId: string, detail: ThreadDetail) => void;
  onFinish: (threadId: string) => void;
  onRefresh: (threadId: string) => Promise<unknown>;
  onError: (threadId: string, error: unknown) => void;
  onFrame: (threadId: string) => (frame: StreamFrame) => void;
  onUnavailable: () => void;
}

export function useThreadRecovery(options: ThreadRecoveryOptions) {
  const inFlight = useRef(new Set<string>());
  return useCallback(
    async (readOnly = false) => {
      const { detail, run } = options;
      if (
        !detail ||
        !run ||
        options.running ||
        inFlight.current.has(detail.thread.id)
      )
        return;
      if (!options.modelConfigured) {
        options.onUnavailable();
        return;
      }
      const threadId = detail.thread.id;
      inFlight.current.add(threadId);
      try {
        options.onStart(threadId, detail);
        await resumeInterruptedRun(
          threadId,
          {
            runId: run.id,
            model: options.model,
            ...(readOnly ? { readOnly: true } : {}),
          },
          options.onFrame(threadId),
        );
        await options.onRefresh(threadId);
      } catch (error) {
        // A lost response may still have created a Run. Reconcile before retry UI.
        await options.onRefresh(threadId).catch(() => undefined);
        options.onError(threadId, error);
      } finally {
        inFlight.current.delete(threadId);
        options.onFinish(threadId);
      }
    },
    [options],
  );
}
