import { useEffect } from "react";

import type { AutomaticRecoveryAttempt } from "@napier/contracts";

export interface UseAutomationRecoveryRefreshOptions {
  attempts: AutomaticRecoveryAttempt[];
  pending: boolean;
  refresh: () => Promise<void>;
}

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
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [attempts, pending, refresh]);
}
