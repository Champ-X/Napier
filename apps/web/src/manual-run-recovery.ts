import type { RunRecord, ThreadStatus } from "@napier/contracts";
import {
  isManuallyResumableRun,
  manualRunRecoverySettlementMatches,
} from "@napier/contracts/manual-run-recovery";

export function latestManuallyResumableRun(
  threadStatus: ThreadStatus,
  runs: RunRecord[],
): RunRecord | undefined {
  const latestSettlement = runs
    .slice()
    .reverse()
    .find((run) => manualRunRecoverySettlementMatches(threadStatus, run));
  return latestSettlement &&
    isManuallyResumableRun(threadStatus, latestSettlement)
    ? latestSettlement
    : undefined;
}
