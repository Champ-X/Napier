import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateCampaignQuality } from "./harness-campaign-evidence.mjs";

const key = ({ caseId, trial }) => JSON.stringify([caseId, trial]);
const armKey = (job) => JSON.stringify([job.caseId, job.trial, job.arm]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A forecast, never qualification evidence. Completed observations are fixed:
 * unrelated successful future pairs cannot repair their evidence or regressions.
 * No attempt is replaced and no failed observation is filtered out. */
export function assessCampaignConvergence({ jobs, statuses, reports, required }) {
  assert.equal(jobs.length, statuses.length);
  const quality = evaluateCampaignQuality(reports, required);
  const observed = new Map(reports.map((r) => [armKey(r), r]));
  const pairs = new Map();
  const identities = new Set();
  for (const [index, job] of jobs.entries()) {
    assert.ok(["candidate", "baseline"].includes(job.arm));
    assert.ok(Number.isSafeInteger(job.trial) && job.trial >= 0);
    assert.ok(!identities.has(armKey(job)), "Duplicate schedule observation");
    identities.add(armKey(job));
    assert.deepEqual(statuses[index].job, job);
    assert.ok(["settled", "failed", "not_started"].includes(statuses[index].status));
    const pair = pairs.get(key(job)) ?? [];
    pair.push({ job, status: statuses[index].status, report: observed.get(armKey(job)) });
    pairs.set(key(job), pair);
  }
  for (const identity of observed.keys())
    assert.ok(identities.has(identity), "Report is outside the original schedule");
  const cases = new Map();
  const irreparablePairs = [];
  let optimisticComparablePairs = 0;
  for (const [pairKey, pair] of pairs) {
    assert.equal(pair.length, 2, "Schedule must retain both arms");
    assert.notEqual(pair[0].job.arm, pair[1].job.arm);
    for (const arm of pair)
      assert.ok(!(arm.status === "not_started" && arm.report), "Unstarted arm has a report");
    const caseId = pair[0].job.caseId;
    if (!cases.has(caseId)) cases.set(caseId, 0);
    const completed = pair.filter((arm) => arm.report).map((arm) => arm.report);
    const pairQuality = evaluateCampaignQuality(completed, { minimumCases: 1, minimumTrials: 1 });
    // An unstarted counterpart can still complete a partial pair. Treat it
    // optimistically; the normal admission/evidence guards remain authoritative.
    const possible = pair.every((arm) => arm.status === "not_started" || arm.report)
      && (completed.length < 2 || pairQuality.promotionReady);
    if (possible) {
      optimisticComparablePairs++;
      cases.set(caseId, cases.get(caseId) + 1);
    } else {
      irreparablePairs.push({ pairKey, caseId, trial: pair[0].job.trial,
        reasons: pairQuality.blockers.length ? pairQuality.blockers : ["Terminal arm lacks a report"] });
    }
  }
  const optimisticQualifiedCases = [...cases.values()].filter((n) => n >= quality.required.minimumTrials).length;
  const completedReports = reports.filter((report) =>
    pairs.get(key(report)).every((arm) => arm.report));
  const fixedQuality = evaluateCampaignQuality(completedReports, quality.required);
  const persistentBlockers = [...fixedQuality.evidenceBlockers, ...fixedQuality.regressions];
  const unreachable = persistentBlockers.length > 0 || irreparablePairs.length > 0
    || optimisticQualifiedCases < quality.required.minimumCases;
  const decision = quality.promotionReady ? "gate_already_passed"
    : unreachable ? "remediate_before_more_model_calls" : "remaining_schedule_can_still_qualify";
  return { kind: "napier.harness-campaign-convergence", schemaVersion: 1,
    decision, allowQualificationDispatch: !unreachable && !quality.promotionReady,
    required: quality.required, currentQuality: quality, persistentBlockers, irreparablePairs,
    optimisticComparablePairs, optimisticQualifiedCases,
    schedulePositions: jobs.length, unstartedPositions: statuses.filter((s) => s.status === "not_started").length,
    modelRequests: 0, scope: "Optimistic reachability only, not approval or promotion evidence. Preserve all observations and limits; no resampling or missing-usage settlement is authorized." };
}

export async function inspectCampaignConvergence(planFile, resultFile) {
  const planBytes = await readFile(planFile), resultBytes = await readFile(resultFile);
  const plan = JSON.parse(planBytes), result = JSON.parse(resultBytes);
  assert.equal(result.planSha256, hash(planBytes));
  const bindings = await Promise.all(result.reports.map(async (summary) => {
    const bytes = await readFile(summary.reportPath), report = JSON.parse(bytes);
    for (const field of ["runId", "caseId", "arm", "trial"])
      assert.equal(report[field], summary[field], "Report identity differs from result");
    return { report, reportPath: summary.reportPath, reportSha256: hash(bytes) };
  }));
  const reports = bindings.map((binding) => binding.report);
  const assessment = assessCampaignConvergence({ jobs: plan.schedule.jobs, statuses: result.statuses,
    reports, required: result.quality.required });
  assert.deepEqual(assessment.currentQuality, result.quality, "Recorded quality differs from current evidence");
  return { ...assessment, planPath: path.resolve(planFile), planSha256: hash(planBytes),
    resultPath: path.resolve(resultFile), resultSha256: hash(resultBytes),
    reportBindings: bindings.map(({ report, ...binding }) => ({ ...binding, runId: report.runId })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [planFile, resultFile, output] = process.argv.slice(2);
  assert.ok(planFile && resultFile && output, "Usage: node scripts/harness-campaign-convergence.mjs PLAN RESULT OUTPUT");
  const assessment = await inspectCampaignConvergence(planFile, resultFile);
  await writeFile(output, JSON.stringify(assessment, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ decision: assessment.decision, optimisticComparablePairs: assessment.optimisticComparablePairs,
    optimisticQualifiedCases: assessment.optimisticQualifiedCases, unstartedPositions: assessment.unstartedPositions, modelRequests: 0 }));
  if (!assessment.allowQualificationDispatch && !assessment.currentQuality.promotionReady) process.exitCode = 2;
}
