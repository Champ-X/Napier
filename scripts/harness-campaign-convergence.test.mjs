import assert from "node:assert/strict";
import { test } from "vitest";
import { assessCampaignConvergence } from "./harness-campaign-convergence.mjs";
import { observation } from "./harness-campaign-test-fixture.mjs";

function assess(reports, { cases = 1, trials = 1, minimumTrials = trials } = {}) {
  const jobs = Array.from({ length: cases }, (_, c) =>
    Array.from({ length: trials }, (_, trial) => ["baseline", "candidate"].map((arm) =>
      ({ caseId: c ? `case_${c}` : "case_one", trial, arm })))).flat(2);
  const statuses = jobs.map((job) => ({ job, status: reports.some((r) =>
    r.caseId === job.caseId && r.trial === job.trial && r.arm === job.arm) ? "settled" : "not_started" }));
  return assessCampaignConvergence({ jobs, statuses, reports,
    required: { minimumCases: cases, minimumTrials } });
}

test("a fresh sufficient schedule remains eligible for necessary collection", () => {
  const result = assess([], { cases: 30, trials: 3 });
  assert.equal(result.allowQualificationDispatch, true);
  assert.equal(result.optimisticComparablePairs, 90);
});
test("one fixed invalid pair prevents a 30 by 3 schedule converging despite 178 future successes", () => {
  const reports = [observation("baseline", { qualifyingEvidence: false }), observation("candidate")];
  const result = assess(reports, { cases: 30, trials: 3 });
  assert.equal(result.decision, "remediate_before_more_model_calls");
  assert.equal(result.optimisticComparablePairs, 89);
  assert.equal(result.optimisticQualifiedCases, 29);
  assert.equal(result.unstartedPositions, 178);
  assert.ok(result.persistentBlockers.length);
  assert.equal(reports[0].qualifyingEvidence, false);
});
test("a retained regression cannot be repaired by surplus successful trial positions", () => {
  const result = assess([observation("baseline"), observation("candidate", { taskSuccess: false })],
    { trials: 4, minimumTrials: 3 });
  assert.equal(result.optimisticQualifiedCases, 1);
  assert.equal(result.allowQualificationDispatch, false);
  assert.ok(result.currentQuality.regressions.length);
});
test("an unstarted counterpart is not confused with immutable evidence failure", () => {
  const result = assess([observation("candidate")]);
  assert.equal(result.allowQualificationDispatch, true);
});
test("complete qualification requires no further paid collection", () => {
  const result = assess([observation("baseline"), observation("candidate")]);
  assert.equal(result.decision, "gate_already_passed");
  assert.equal(result.allowQualificationDispatch, false);
});
test("insufficient scheduled trials do not trigger futile collection", () => {
  assert.equal(assess([], { minimumTrials: 3 }).allowQualificationDispatch, false);
});
