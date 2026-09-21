import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { evaluateCampaignQuality } from "./harness-campaign-evidence.mjs";
import { apiRequestBudgetEvidenceEligible } from "./harness-api-request-budget.mjs";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const key = (report) => JSON.stringify([report.caseId, report.trial]);
const required = { minimumCases: 30, minimumTrials: 3 };
const evidenceReason = (report) =>
  `${report.caseId}:${report.trial}: missing, changed or exhausted API request budget evidence`;

/** Explicit prospective protocol. An ineligible baseline does not become valid:
 * retire its WHOLE pair from the qualification sample and require a new, unused
 * trial. Keep raw quality, report identities and all adverse outcomes visible.
 * Eligible baseline failures and every candidate failure are non-retirable. */
export function createMissingUsageRecovery({ baseline, candidate, jobs }) {
  assert.equal(baseline.arm, "baseline");
  assert.equal(candidate.arm, "candidate");
  assert.equal(key(baseline), key(candidate));
  assert.equal(baseline.status, "failed");
  assert.equal(baseline.taskSuccess, false);
  assert.equal(baseline.graderExitCode, 0);
  assert.equal(candidate.status, "completed");
  assert.equal(candidate.taskSuccess, true, "Candidate failures cannot be retired");
  assert.equal(candidate.graderExitCode, 0);
  assert.equal(candidate.allowedChanges, true);
  assert.ok(apiRequestBudgetEvidenceEligible(candidate));
  const rawPairQuality = evaluateCampaignQuality([baseline, candidate]);
  assert.deepEqual(rawPairQuality.regressions, []);
  assert.deepEqual(rawPairQuality.evidenceBlockers, [evidenceReason(baseline)]);
  const { before, after } = baseline.spendingBudget;
  assert.ok(after.reservedRequests > before.reservedRequests);
  assert.ok(after.requests > before.requests);
  assert.equal(after.denied, before.denied);
  assert.equal(after.maxFen, before.maxFen);
  assert.equal(after.priorSpendFen, before.priorSpendFen);
  assert.deepEqual(after.policy, before.policy);
  assert.ok(after.remainingFen >= 0);
  for (const field of ["maxFen", "priorSpendFen", "policy"])
    assert.deepEqual(before[field], candidate.spendingBudget.before[field]);
  for (const field of ["fixtureSha256", "promptSha256", "outcomeSha256", "acceptanceSha256",
    "memorySeedSha256", "campaignScriptSha256", "campaignHelperSha256", "sandbox", "requestedModel", "runLimits"])
    assert.deepEqual(baseline[field], candidate[field], `Original pair differs: ${field}`);
  // Validate the admission-only evidence separately; a denied or exhausted
  // request policy is not the missing-terminal-usage condition supported here.
  const api = baseline.apiRequestBudget;
  for (const state of [api.before, api.after]) {
    assert.equal(state.kind, "napier.harness-api-request-budget");
    assert.equal(state.schemaVersion, 1);
    assert.ok(Number.isSafeInteger(state.maxRequests) && state.maxRequests > 0);
    assert.ok(Number.isSafeInteger(state.admitted) && state.admitted >= 0);
    assert.ok(Number.isSafeInteger(state.minIntervalMs) && state.minIntervalMs >= 0);
    assert.ok(state.minIntervalMs <= 3_600_000);
    assert.ok(Number.isSafeInteger(state.denied) && state.denied >= 0);
    assert.ok(state.admitted < state.maxRequests);
    assert.equal(state.remaining, state.maxRequests - state.admitted);
    assert.equal(state.billingCeilingEstablished, false);
    assert.equal(state.policySha256, hash({ maxRequests: state.maxRequests, minIntervalMs: state.minIntervalMs }));
  }
  assert.equal(api.before.policySha256, api.after.policySha256);
  assert.equal(api.before.policySha256, candidate.apiRequestBudget.before.policySha256);
  assert.equal(api.before.denied, api.after.denied);
  assert.ok(api.after.admitted >= api.before.admitted);
  const original = jobs.filter((job) => key(job) === key(baseline));
  assert.equal(original.length, 2);
  assert.deepEqual(original.map((job) => job.arm).sort(), ["baseline", "candidate"]);
  const nextTrial = Math.max(...jobs.filter((job) => job.caseId === baseline.caseId).map((job) => job.trial)) + 1;
  assert.ok(Number.isSafeInteger(nextTrial));
  const content = { kind: "napier.missing-usage-recovery-protocol", schemaVersion: 1,
    required, caseId: baseline.caseId, originalTrial: baseline.trial, supplementalTrial: nextTrial,
    baselineRunId: baseline.runId, baselineReportDigest: hash(baseline),
    candidateRunId: candidate.runId, candidateReportDigest: hash(candidate),
    originalScheduleDigest: hash(jobs), originalSchedulePositions: jobs.length,
    originalPairQuality: rawPairQuality, originalReservationDelta: after.reservedRequests - before.reservedRequests,
    originalRunIdsMustRemainVisible: [baseline.runId, candidate.runId],
    scope: "A new prospective qualification cohort, not repair or promotion of the original campaign. Preserve the original schedule and append one whole new trial; require three eligible pairs per case. No candidate failure or eligible baseline failure may be retired. No reservation is released." };
  return { ...content, contentSha256: hash(content) };
}

export function evaluateRecoveredCampaignQuality(reports, protocol, originalJobs) {
  const baseline = reports.find((r) => r.runId === protocol.baselineRunId);
  const candidate = reports.find((r) => r.runId === protocol.candidateRunId);
  assert.ok(baseline && candidate, "Original observations must remain present");
  assert.deepEqual(createMissingUsageRecovery({ baseline, candidate, jobs: originalJobs }), protocol);
  const scheduled = new Set(originalJobs.map((job) => JSON.stringify([job.caseId, job.trial, job.arm])));
  for (const arm of ["baseline", "candidate"])
    scheduled.add(JSON.stringify([protocol.caseId, protocol.supplementalTrial, arm]));
  for (const report of reports)
    assert.ok(scheduled.has(JSON.stringify([report.caseId, report.trial, report.arm])), "Unscheduled recovery observation");
  // Run the unmodified evaluator over ALL reports first. Identity/source/task
  // errors and regressions remain fatal even if they involve the retired pair.
  const rawQuality = evaluateCampaignQuality(reports, required);
  const retained = reports.filter((r) => key(r) !== key(baseline));
  const qualificationQuality = evaluateCampaignQuality(retained, required);
  const unexpectedBlockers = rawQuality.evidenceBlockers.filter((reason) => reason !== evidenceReason(baseline));
  const newTrial = retained.filter((r) => r.caseId === protocol.caseId && r.trial === protocol.supplementalTrial);
  const supplementalQuality = evaluateCampaignQuality(newTrial, { minimumCases: 1, minimumTrials: 1 });
  const supplementalRequired = !supplementalQuality.promotionReady;
  const promotionReady = qualificationQuality.promotionReady && !supplementalRequired
    && rawQuality.regressions.length === 0 && unexpectedBlockers.length === 0;
  return { kind: "napier.recovered-campaign-quality", schemaVersion: 1,
    recoveryProtocolSha256: protocol.contentSha256, required,
    rawQuality, qualificationQuality, unexpectedBlockers,
    retiredIneligibleObservations: [baseline, candidate].map((r) => ({ runId: r.runId,
      caseId: r.caseId, trial: r.trial, arm: r.arm, status: r.status, taskSuccess: r.taskSuccess,
      reportDigest: hash(r) })),
    supplementalTrialRequired: supplementalRequired, supplementalTrial: protocol.supplementalTrial,
    originalCampaignPromotionReady: rawQuality.promotionReady, promotionReady,
    scope: protocol.scope };
}
