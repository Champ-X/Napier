import path from "node:path";
import { evaluateCampaignQuality } from "./harness-campaign-evidence.mjs";
import { apiRequestBudgetEvidenceEligible } from "./harness-api-request-budget.mjs";

/** Complete one pair before spending on another. Trial identity is assigned
 * before dispatch and is never rewritten to hide a failed observation. */
export function pairedSuiteJobs(cases, output, trials, priority = []) {
  if (!Number.isSafeInteger(trials) || trials < 1 || trials > 100)
    throw new Error("Invalid paired trial count");
  if (
    new Set(priority).size !== priority.length ||
    priority.some((id) => !cases.some((item) => item.id === id))
  )
    throw new Error("Priority cases must be unique existing suite cases");
  const ordered = [
    ...priority.map((id) => cases.find((item) => item.id === id)),
    ...cases.filter((item) => !priority.includes(item.id)),
  ];
  return Array.from({ length: trials }, (_, trial) =>
    ordered.flatMap((item, index) =>
      ((index + trial) % 2
        ? ["candidate", "baseline"]
        : ["baseline", "candidate"]
      ).map((arm) => ({
        caseId: item.id,
        caseRoot: item.path,
        arm,
        trial,
        output: path.join(output, `${item.id}-${arm}-trial-${trial + 1}`),
      })),
    ),
  ).flat();
}

export async function executePairedSuiteJobs(
  jobs,
  execute,
  readReport,
  { signal, checkpoint = async () => {} } = {},
) {
  for (let i = 0; i < jobs.length; i += 2) {
    const a = jobs[i],
      b = jobs[i + 1];
    if (
      !b ||
      a.caseId !== b.caseId ||
      a.trial !== b.trial ||
      !["baseline", "candidate"].includes(a.arm) ||
      !["baseline", "candidate"].includes(b.arm) ||
      a.arm === b.arm
    )
      throw new Error("Schedule must contain adjacent complete trial pairs");
  }
  const statuses = [],
    reports = [];
  let stop;
  for (const job of jobs) {
    if (signal?.aborted) {
      stop = { reason: "cancelled" };
      break;
    }
    let status;
    try {
      const result = await execute(job, signal);
      status = { job, status: "settled", result };
      if (result.exitCode !== 0)
        stop = { reason: result.reason ?? "job_failed", job };
      else {
        const report = await readReport(job);
        if (
          report.caseId !== job.caseId ||
          report.arm !== job.arm ||
          report.trial !== job.trial
        )
          throw new Error("Report identity differs from scheduled trial");
        reports.push(report);
      }
    } catch (error) {
      status = {
        ...(status ?? { job }),
        status: "failed",
        error: String(error.message ?? error),
      };
      stop = { reason: "execution_or_evidence_failed", job };
    }
    statuses.push(status);
    // An invalid first arm cannot form an eligible pair. Check before paying
    // for its counterpart; the complete-pair evaluator still owns promotion.
    if (
      !stop &&
      statuses.length % 2 === 1 &&
      !apiRequestBudgetEvidenceEligible(reports.at(-1))
    )
      stop = {
        reason: "evidence_invalid",
        job,
        evidenceBlockers: [
          "First arm has incomplete, changed or exhausted request/spending evidence",
        ],
      };
    if (!stop && statuses.length % 2 === 0) {
      const quality = evaluateCampaignQuality(reports);
      if (quality.regressions.length || quality.evidenceBlockers.length)
        stop = {
          reason: quality.regressions.length
            ? "quality_regressed"
            : "evidence_invalid",
          job,
          quality,
        };
    }
    await checkpoint({
      status,
      stop: stop ?? null,
      completedJobs: statuses.length,
    });
    if (stop) break;
  }
  return {
    statuses: jobs.map(
      (job, index) => statuses[index] ?? { job, status: "not_started" },
    ),
    stop: stop ?? null,
  };
}
