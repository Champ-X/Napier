import assert from "node:assert/strict";
import { test } from "vitest";
import { observation } from "./harness-campaign-test-fixture.mjs";
import { summarizePairedCampaign } from "./harness-paired-summary.mjs";

test("reports paired deltas and retains an eligible failed baseline", () => {
  const result = summarizePairedCampaign([
    observation("baseline", { durationMs: 400, taskSuccess: false, status: "failed", graderExitCode: 0, toolFailures: 3 }),
    observation("candidate", { durationMs: 250, graderExitCode: 0, toolFailures: 1 }),
    observation("baseline", { trial: 1, durationMs: 300, graderExitCode: 0, toolFailures: 2 }),
    observation("candidate", { trial: 1, durationMs: 200, graderExitCode: 0, toolFailures: 0 }),
  ]);
  assert.equal(result.pairs.length, 2);
  assert.equal(result.armSummary.baseline.completedTasks, 1);
  assert.equal(result.armSummary.baseline.passedGraders, 2);
  assert.equal(result.armSummary.candidate.medianDurationMs, 225);
  assert.equal(result.pairedMedianDurationDifferenceMs, -125);
  assert.equal(result.armSummary.baseline.totalToolFailures, 5);
  assert.equal(result.quality.promotionReady, false);
  assert.deepEqual(result.quality.required, { minimumCases: 30, minimumTrials: 3 });
});

test("retains candidate regressions rather than filtering them from statistics", () => {
  const result = summarizePairedCampaign([
    observation("baseline", { durationMs: 100, graderExitCode: 0 }),
    observation("candidate", { durationMs: 80, graderExitCode: 1, taskSuccess: false, status: "failed" }),
  ]);
  assert.equal(result.pairs.length, 1);
  assert.equal(result.armSummary.candidate.completedTasks, 0);
  assert.ok(result.pairs[0].regressions.length > 0);
  assert.equal(result.quality.verdict, "regressed");
});

test("unknown metrics stay null and unpaired observations remain explicit", () => {
  const result = summarizePairedCampaign([
    observation("baseline"), observation("candidate"),
    observation("candidate", { trial: 1 }),
  ]);
  assert.equal(result.rawObservations, 3);
  assert.equal(result.pairs.length, 1);
  assert.equal(result.excluded.length, 1);
  assert.equal(result.pairedMedianDurationDifferenceMs, null);
  assert.equal(result.pairedMedianAdmissionDifference, null);
  assert.equal(result.armSummary.baseline.originalObservationCostFen, null);
  assert.equal(result.armSummary.baseline.passedGraders, null);
});

test("empty samples cannot imply zero cost, perfect quality or promotion", () => {
  const result = summarizePairedCampaign([]);
  assert.equal(result.armSummary.baseline.observations, 0);
  assert.equal(result.armSummary.baseline.totalDurationMs, null);
  assert.equal(result.quality.promotionReady, false);
});
