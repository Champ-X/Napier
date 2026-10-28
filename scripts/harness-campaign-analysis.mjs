import { evaluateCampaignQuality } from "./harness-campaign-evidence.mjs";
import {
  analysisDigest,
  campaignCell,
  validateCampaignAnalysisPlan,
} from "./harness-campaign-analysis-plan.mjs";

/** Reuse the existing campaign's stricter source/environment/grader/scope gate.
 * Statistics never remove failures, repair a missing cell or waive that gate. */
export async function evaluateCampaignAnalysis({ plan, reports, statuses }) {
  await validateCampaignAnalysisPlan(plan);
  const { evaluateHarnessExperiment } =
    await import("../packages/harness-eval/dist/harness-experiments.js");
  const quality = evaluateCampaignQuality(reports);
  const blockers = [...quality.blockers, ...quality.regressions];
  const positions = new Map(
    plan.schedule.map((job, index) => [campaignCell(job), index]),
  );
  const seen = new Set();
  const trials = [];
  for (const report of reports) {
    const key = campaignCell(report),
      position = positions.get(key);
    if (position === undefined || seen.has(key))
      throw new Error(`Unscheduled or duplicate analysis report: ${key}`);
    seen.add(key);
    const item = plan.cases.find((item) => item.id === report.caseId);
    const binding = {
      planSha256: plan.contentSha256,
      experimentSha256: plan.experiment.contentSha256,
      schedulePosition: position,
      caseInputSha256: item.inputSha256,
    };
    if (analysisDigest(report.analysisBinding) !== analysisDigest(binding))
      blockers.push(`${key}: analysis binding missing or changed`);
    for (const field of [
      "fixtureSha256",
      "promptSha256",
      "outcomeSha256",
      "memorySeedSha256",
    ])
      if ((report[field] ?? null) !== (item[field] ?? null))
        blockers.push(`${key}: preregistered input mismatch: ${field}`);
    const expectedProfile =
      plan.experiment[`${report.arm}Profile`].contentSha256;
    if (report.profile?.contentSha256 !== expectedProfile)
      blockers.push(`${key}: preregistered profile mismatch`);
    if (!Number.isInteger(report.graderExitCode) || report.graderExitCode < 0)
      blockers.push(`${key}: missing independent grader outcome`);
    trials.push({
      caseId: report.caseId,
      seed: report.trial,
      arm: report.arm,
      runId: report.runId,
      servingModel: report.requestedModel,
      fallbackUsed: report.servingIdentityMatched !== true,
      profileSha256: report.profile?.contentSha256 ?? "0".repeat(64),
      harnessReceiptSha256: analysisDigest(report),
      evidenceKind: report.evidenceKind ?? "contract_fixture",
      metrics: reportMetrics(report),
    });
  }
  if (statuses.length !== plan.schedule.length)
    blockers.push("dispatch status count differs from original schedule");
  for (const [index, job] of plan.schedule.entries()) {
    const status = statuses[index];
    if (
      !status ||
      campaignCell(status.job) !== campaignCell(job) ||
      status.status !== "settled" ||
      status.result?.exitCode !== 0
    )
      blockers.push(
        `${campaignCell(job)}: original dispatch did not settle successfully`,
      );
  }
  const evaluation = evaluateHarnessExperiment(plan.experiment, trials);
  if (!["improved", "non_inferior"].includes(evaluation.verdict))
    blockers.push(`statistical_decision:${evaluation.verdict}`);
  const kind = plan.experiment.analysis.evidenceKind;
  const claimScope = {
    contract_fixture: "contract_only",
    deterministic_integration: "integration_only",
    live_model: "live_quality",
    production_task: "production_quality",
  }[kind];
  if (!["live_model", "production_task"].includes(kind))
    blockers.push("evidence_does_not_support_live_quality");
  if (!plan.experiment.cases.some((item) => item.partition === "holdout"))
    blockers.push("untuned_task_family_evidence_missing");
  if (plan.experiment.cases.some((item) => item.partition === "tuning"))
    blockers.push("tuning_partition_is_not_qualification");
  if (
    reports.some((report) =>
      /fixture|faux|mock|^test$/iu.test(report.requestedModel?.provider ?? ""),
    )
  )
    blockers.push("fixture_provider_cannot_support_live_quality");
  const content = {
    kind: "napier.harness-campaign-analysis",
    schemaVersion: 1,
    planSha256: plan.contentSha256,
    quality,
    evaluation,
    claimScope,
    reportBindings: reports.map((report) => ({
      caseId: report.caseId,
      trial: report.trial,
      arm: report.arm,
      runId: report.runId,
      reportSha256: analysisDigest(report),
      sourceIdentity: report.sourceIdentity,
      runtimeArtifactSha256: report.runtimeArtifactSha256,
      environmentSha256: report.environmentEvidence?.contentSha256,
      graderSha256: report.outcomeSha256,
      profileSha256: report.profile?.contentSha256,
    })),
    blockers: [...new Set(blockers)],
    promotionReady: blockers.length === 0,
  };
  return { ...content, contentSha256: analysisDigest(content) };
}

function reportMetrics(report) {
  const result = {
    task_success: report.taskSuccess ? 1 : 0,
    ...(Number.isInteger(report.graderExitCode) && report.graderExitCode >= 0
      ? {
          false_completion:
            report.status === "completed" && !report.taskSuccess ? 1 : 0,
        }
      : {}),
  };
  for (const [metric, field] of [
    ["duration_ms", "durationMs"],
    ["tool_call_count", "toolCalls"],
    ["intervention_count", "interventionCount"],
  ])
    if (Number.isFinite(report[field]) && report[field] >= 0)
      result[metric] = report[field];
  const receipt = report.usageEvidence;
  if (
    receipt?.runId === report.runId &&
    receipt.eligibleForObservedUsageComparison === true
  ) {
    const { contentSha256, ...content } = receipt;
    if (
      analysisDigest(content) === contentSha256 &&
      analysisDigest(receipt.persistedUsage) === analysisDigest(report.usage)
    ) {
      for (const [metric, field] of [
        ["input_tokens", "inputTokens"],
        ["output_tokens", "outputTokens"],
        ["cost_usd", "costUsd"],
      ])
        if (Number.isFinite(report.usage[field]) && report.usage[field] >= 0)
          result[metric] = report.usage[field];
    }
  }
  return result;
}
