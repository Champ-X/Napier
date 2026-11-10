import { useEffect } from "react";

import type { AutomaticRecoveryAttempt } from "@napier/contracts";

export interface UseAutomationRecoveryRefreshOptions {
  attempts: AutomaticRecoveryAttempt[];
  pending: boolean;
  refresh: (signal?: AbortSignal) => Promise<void>;
}

const REFRESH_MS = 3_000;

export function useAutomationRecoveryRefresh({
  attempts,
  pending,
  refresh,
}: UseAutomationRecoveryRefreshOptions): void {
  useEffect(() => {
    const active = attempts.some(
      (attempt) => attempt.status === "claimed" || attempt.status === "running",
    );
    if (!pending && !active) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const tick = async (): Promise<void> => {
      try {
        await refresh(controller.signal);
      } catch {
        // Retry after settle; abort ends the loop.
      } finally {
        if (!controller.signal.aborted) {
          timer = window.setTimeout(() => void tick(), REFRESH_MS);
        }
      }
    };
    timer = window.setTimeout(() => void tick(), REFRESH_MS);
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [attempts, pending, refresh]);
}
