import { evaluateCampaignQuality } from "./harness-campaign-evidence.mjs";

/** Descriptive paired statistics only. Original evidence qualification owns
 * acceptance; failures and incomplete observations remain visible. Reused
 * baselines contribute their original cost, never a claim of new spending. */
export function summarizePairedCampaign(reports) {
  const quality = evaluateCampaignQuality(reports), grouped = new Map();
  for (const report of reports) {
    const key = `${report.caseId}:${report.trial}`;
    const pair = grouped.get(key) ?? [];
    pair.push(report); grouped.set(key, pair);
  }
  const pairs = [], excluded = [];
  for (const [key, pair] of grouped) {
    const assessment = evaluateCampaignQuality(pair, { minimumCases: 1, minimumTrials: 1 });
    // A regression is still an eligible observation; never select on success.
    if (assessment.comparablePairs !== 1) {
      excluded.push({ key, runIds: pair.map(r => r.runId), blockers: assessment.blockers });
      continue;
    }
    const baseline = pair.find(r => r.arm === "baseline"), candidate = pair.find(r => r.arm === "candidate");
    pairs.push({ key, caseId: baseline.caseId, trial: baseline.trial,
      baseline: metrics(baseline), candidate: metrics(candidate),
      regressions: assessment.regressions });
  }
  const armSummary = {};
  for (const arm of ["baseline", "candidate"]) {
    const values = pairs.map(p => p[arm]);
    armSummary[arm] = { observations: values.length,
      completedTasks: values.filter(r => r.taskSuccess).length,
      passedGraders: values.some(r => r.graderPassed === null) ? null : values.filter(r => r.graderPassed).length,
      medianDurationMs: median(values.map(r => r.durationMs)),
      totalDurationMs: sum(values.map(r => r.durationMs)),
      totalAdmissions: sum(values.map(r => r.admissions)),
      totalToolFailures: sum(values.map(r => r.toolFailures)),
      originalObservationCostFen: sum(values.map(r => r.originalCostFen)),
      totalInputTokens: sum(values.map(r => r.inputTokens)),
      totalOutputTokens: sum(values.map(r => r.outputTokens)),
      totalCacheReadTokens: sum(values.map(r => r.cacheReadTokens)) };
  }
  return { kind: "napier.harness-paired-descriptive-summary", schemaVersion: 1,
    quality, rawObservations: reports.length, pairs, excluded, armSummary,
    pairedMedianDurationDifferenceMs: median(pairs.map(p => difference(p.candidate.durationMs, p.baseline.durationMs))),
    pairedMedianAdmissionDifference: median(pairs.map(p => difference(p.candidate.admissions, p.baseline.admissions))),
    interpretation: "Descriptive observations only; trials share task families and reused baselines are not concurrent randomized controls. Original observation costs include reused evidence and are not newly spent campaign cost. Missing metrics are null, never zero. Quality qualification remains the unchanged 30-case/3-trial gate." };
}
function metrics(report) {
  return { runId: report.runId, taskSuccess: report.taskSuccess, graderPassed: Number.isInteger(report.graderExitCode) && report.graderExitCode >= 0 ? report.graderExitCode === 0 : null,
    durationMs: number(report.durationMs), admissions: number(report.apiRequestBudget?.after?.admitted),
    toolFailures: number(report.toolFailures),
    originalCostFen: report.spendingBudget ? number(report.spendingBudget.after.committedFen - report.spendingBudget.before.committedFen) : null,
    inputTokens: number(report.usage?.inputTokens), outputTokens: number(report.usage?.outputTokens), cacheReadTokens: number(report.usage?.cacheReadTokens) };
}
function number(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function difference(a, b) { return a === null || b === null ? null : a - b; }
function sum(values) { return values.length && values.every(v => v !== null) ? values.reduce((n,v) => n + v, 0) : null; }
function median(values) {
  if (!values.length || values.some(v => v === null)) return null;
  const ordered = [...values].sort((a,b) => a-b), index = Math.floor(ordered.length/2);
  return ordered.length % 2 ? ordered[index] : (ordered[index-1] + ordered[index])/2;
}
