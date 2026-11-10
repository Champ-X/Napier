import { useCallback, useMemo, useRef } from "react";

import { ActiveRunStreamAbort } from "./active-run-stream-abort";
import type { NextRunPromptInput } from "./next-run-capability-preset-execution";

/** One AbortController owner for prompt/resume SSE readers in a workspace view. */
export function useActiveRunStream() {
  const abortRef = useRef(new ActiveRunStreamAbort());
  const wrapExecute = useCallback(
    (execute: (input: NextRunPromptInput) => Promise<void>) =>
      async (input: NextRunPromptInput) => {
        const signal = abortRef.current.begin();
        try {
          await execute({ ...input, signal });
        } finally {
          abortRef.current.release(signal);
        }
      },
    [],
  );
  const streamSignalBindings = useMemo(
    () => ({
      beginStreamSignal: () => abortRef.current.begin(),
      releaseStreamSignal: (signal: AbortSignal) =>
        abortRef.current.release(signal),
    }),
    [],
  );
  const abort = useCallback(() => abortRef.current.abort(), []);
  return { wrapExecute, streamSignalBindings, abort };
}
