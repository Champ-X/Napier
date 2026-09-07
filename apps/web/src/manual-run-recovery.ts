import type { RunRecord, ThreadStatus } from "@napier/contracts";
import { isManuallyResumableRun } from "@napier/contracts/manual-run-recovery";

export function latestManuallyResumableRun(
  threadStatus: ThreadStatus,
  runs: RunRecord[],
): RunRecord | undefined {
  // A later run supersedes the previous checkpoint, including a successful recovery.
  const latestSettlement = runs.at(-1);
  return latestSettlement &&
    isManuallyResumableRun(threadStatus, latestSettlement)
    ? latestSettlement
    : undefined;
}
