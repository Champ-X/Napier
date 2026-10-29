import type { RunRecord } from "./execution-runs.js";

/** Child execution records remain inspectable but never own Thread controls. */
export function isSubagentChildRun(run: Pick<RunRecord, "source">): boolean {
  return run.source === "subagent";
}

/** Preserve ordered Run history; recovery descendants are primary. */
export function latestPrimaryRun(runs: readonly RunRecord[]): RunRecord | undefined {
  return runs.findLast((run) => !isSubagentChildRun(run));
}
