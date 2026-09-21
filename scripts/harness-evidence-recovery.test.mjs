import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { observation } from "./harness-campaign-test-fixture.mjs";
import { FLASH_SPENDING_POLICY } from "./harness-spending-budget.mjs";
import { createMissingUsageRecovery, evaluateRecoveredCampaignQuality } from "./harness-evidence-recovery.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const admissionPolicy = { maxRequests: 64, minIntervalMs: 15000 };
const api = (admitted) => ({ kind: "napier.harness-api-request-budget", schemaVersion: 1,
  ...admissionPolicy, policySha256: hash(JSON.stringify(admissionPolicy)), admitted,
  denied: 0, remaining: 64 - admitted, billingCeilingEstablished: false });
const spending = (reserved, requests) => ({ kind: "napier.harness-spending-budget", schemaVersion: 1,
  currency: "CNY", maxFen: 10000, priorSpendFen: 0, committedFen: reserved ? 600 : requests,
  remainingFen: 10000 - (reserved ? 600 : requests), requests, reservedRequests: reserved,
  denied: 0, policy: FLASH_SPENDING_POLICY });
function report(arm, caseId = "case_one", trial = 0, missing = false) {
  return observation(arm, { caseId, trial, fixtureSha256: hash(caseId), graderExitCode: 0,
    ...(missing ? { status: "failed", taskSuccess: false } : {}),
    apiRequestBudget: { before: api(0), after: api(1) },
    spendingBudget: { before: spending(0, 0), after: spending(missing ? 1 : 0, 1) } });
}
function fixture() {
  const jobs = Array.from({ length: 30 }, (_, c) => Array.from({ length: 3 }, (_, trial) =>
    ["baseline", "candidate"].map((arm) => ({ caseId: c ? `case_${c}` : "case_one", trial, arm })))).flat(2);
  const baseline = report("baseline", "case_one", 0, true), candidate = report("candidate");
  return { jobs, baseline, candidate };
}

test("recovery preserves the original failure and requires a genuinely unused trial", () => {
  const f = fixture(), original = structuredClone(f);
  const protocol = createMissingUsageRecovery(f);
  assert.equal(protocol.supplementalTrial, 3);
  assert.equal(protocol.originalSchedulePositions, 180);
  assert.deepEqual(protocol.required, { minimumCases: 30, minimumTrials: 3 });
  const result = evaluateRecoveredCampaignQuality([f.baseline, f.candidate], protocol, f.jobs);
  assert.equal(result.promotionReady, false);
  assert.equal(result.supplementalTrialRequired, true);
  assert.equal(result.rawQuality.evidenceBlockers.length, 1);
  assert.equal(result.retiredIneligibleObservations[0].status, "failed");
  assert.deepEqual(f, original);
});
test("only all thirty cases with three valid pairs can qualify the recovered cohort", () => {
  const f = fixture(), protocol = createMissingUsageRecovery(f);
  const reports = f.jobs.map((job) => job.caseId === "case_one" && job.trial === 0
    ? job.arm === "baseline" ? f.baseline : f.candidate : report(job.arm, job.caseId, job.trial));
  const before = evaluateRecoveredCampaignQuality(reports, protocol, f.jobs);
  assert.equal(before.qualificationQuality.comparablePairs, 89);
  assert.equal(before.promotionReady, false);
  reports.push(report("baseline", "case_one", 3), report("candidate", "case_one", 3));
  const result = evaluateRecoveredCampaignQuality(reports, protocol, f.jobs);
  assert.equal(result.qualificationQuality.comparablePairs, 90);
  assert.equal(result.qualificationQuality.cases, 30);
  assert.equal(result.promotionReady, true);
  assert.equal(result.originalCampaignPromotionReady, false);
  assert.equal(result.rawQuality.evidenceBlockers.length, 1);
  assert.equal(result.retiredIneligibleObservations.length, 2);
});
test("complete failed baselines cannot be retired", () => {
  const f = fixture();
  f.baseline.spendingBudget.after = spending(0, 1);
  assert.throws(() => createMissingUsageRecovery(f));
});
test("candidate failures or observed baseline code defects cannot be retired", () => {
  for (const role of ["candidate", "baseline"]) {
    const f = fixture();
    if (role === "candidate") f.candidate.taskSuccess = false;
    else f.baseline.graderExitCode = 1;
    assert.throws(() => createMissingUsageRecovery(f));
  }
});
test("a denied API request or changed input is not a missing-usage recovery", () => {
  const denied = fixture();
  denied.baseline.apiRequestBudget.after.denied = 1;
  assert.throws(() => createMissingUsageRecovery(denied));
  const changed = fixture();
  changed.baseline.promptSha256 = hash("changed prompt");
  assert.throws(() => createMissingUsageRecovery(changed));
});
test("tampering, omission, relabeling and unscheduled observations reject", () => {
  const f = fixture(), protocol = createMissingUsageRecovery(f);
  assert.throws(() => evaluateRecoveredCampaignQuality([f.candidate], protocol, f.jobs));
  assert.throws(() => evaluateRecoveredCampaignQuality([f.baseline, { ...f.candidate, trial: 3 }], protocol, f.jobs));
  assert.throws(() => evaluateRecoveredCampaignQuality([f.baseline, f.candidate], { ...protocol, supplementalTrial: 4 }, f.jobs));
  assert.throws(() => evaluateRecoveredCampaignQuality([f.baseline, f.candidate, report("candidate", "case_one", 99)], protocol, f.jobs));
});
test("a new candidate failure remains a regression under recovery", () => {
  const f = fixture(), protocol = createMissingUsageRecovery(f);
  const failed = { ...report("candidate", "case_one", 3), status: "failed", taskSuccess: false, graderExitCode: 1 };
  const result = evaluateRecoveredCampaignQuality([f.baseline, f.candidate, report("baseline", "case_one", 3), failed], protocol, f.jobs);
  assert.equal(result.promotionReady, false);
  assert.ok(result.rawQuality.regressions.length > 0);
  assert.ok(result.unexpectedBlockers.length > 0);
});
