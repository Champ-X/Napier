import type { RunRecord } from "@napier/contracts";

import type { LedgerRunLease } from "./sqlite-run-leases.js";

export interface LeaseBackedRun extends RunRecord {
  leaseTokenSha256?: string;
}

export function applyNormalizedRunLeases(
  runs: LeaseBackedRun[],
  leases: readonly LedgerRunLease[],
): void {
  const byRunId = new Map(runs.map((run) => [run.id, run]));
  const retained = new Set<string>();
  for (const row of leases) {
    const run = byRunId.get(row.runId);
    if (
      !run ||
      run.threadId !== row.threadId ||
      run.status !== "running" ||
      retained.has(run.id)
    ) {
      throw new Error("SQLite Run lease binding is invalid");
    }
    run.lease = structuredClone(row.lease);
    run.leaseTokenSha256 = row.tokenSha256;
    retained.add(run.id);
  }
  for (const run of runs) {
    if (retained.has(run.id)) continue;
    delete run.lease;
    delete run.leaseTokenSha256;
  }
}
