import assert from "node:assert/strict";
import path from "node:path";

/** Matches run-harness-optimization-campaign's zero-based --trial-offset.
 * The outer output name is not the trial directory or a source of identity. */
export function trialResultPath(job) {
  assert.ok(typeof job.output === "string" && job.output.length > 0);
  assert.ok(Number.isSafeInteger(job.trial) && job.trial >= 0 && job.trial < Number.MAX_SAFE_INTEGER);
  return path.join(job.output, `trial-${job.trial + 1}`, "result.json");
}

/** Log and command receipts must not collide across the three paired trials. */
export function trialJobStem(job) {
  assert.ok(/^[a-z0-9][a-z0-9_-]*$/.test(job.caseId));
  assert.ok(["baseline", "candidate"].includes(job.arm));
  assert.ok(Number.isSafeInteger(job.trial) && job.trial >= 0 && job.trial < Number.MAX_SAFE_INTEGER);
  return `${job.caseId}-${job.arm}-trial-${job.trial + 1}`;
}
