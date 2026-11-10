import type { LocalStore } from "./store.js";
import {
  runCancelRequestAppendInput,
  type RunCancelRequestPayload,
} from "./run-cancel-request.js";

/**
 * Persist cancel control, then abort. Matches Pi Durable: abort is control, not
 * a phase inferred after the signal fires.
 */
export async function requestCancelThenAbort(
  store: Pick<LocalStore, "appendEvent">,
  input: {
    threadId: string;
    runId: string;
    abort: () => void;
    reason: RunCancelRequestPayload["reason"];
  },
): Promise<void> {
  try {
    await store.appendEvent(
      runCancelRequestAppendInput({
        threadId: input.threadId,
        runId: input.runId,
        reason: input.reason,
      }),
    );
  } catch {
    // Missing cancel evidence still allows abort; recovery treats uncertainty.
  }
  input.abort();
}
