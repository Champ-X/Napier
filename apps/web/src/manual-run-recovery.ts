import type { RunRecord, ThreadStatus } from "@napier/contracts";
import { isManuallyResumableRun } from "@napier/contracts/manual-run-recovery";
import { latestPrimaryRun } from "@napier/contracts/task-narrative";

export function latestManuallyResumableRun(
  threadStatus: ThreadStatus,
  runs: RunRecord[],
): RunRecord | undefined {
  // A later run supersedes the previous checkpoint, including a successful recovery.
  const latestSettlement = latestPrimaryRun(runs);
  return latestSettlement &&
    isManuallyResumableRun(threadStatus, latestSettlement)
    ? latestSettlement
    : undefined;
}
