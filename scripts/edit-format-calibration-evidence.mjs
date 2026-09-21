import { createHash } from "node:crypto";
import { evaluateCampaignQuality } from "./harness-campaign-evidence.mjs";
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const operation = {
  structured_patch: "replace",
  hashline: "hashline_replace",
  unified_diff: "unified_diff",
};

/** Source reports remain the evidence: do not retrofit a preferred format into
 * a historical profile or count format availability as format exercise. */
export function calibrationEntryFromReports(id, reports) {
  const candidate = reports.filter((report) => report.arm === "candidate");
  if (!candidate.length)
    throw new Error("Calibration requires candidate observations");
  const first = candidate[0];
  const preference = first.profile?.policies?.toolSurface.editPreference;
  if (!preference || !operation[preference.dialect])
    throw new Error(
      "Calibration requires a tested model/task format preference",
    );
  const gate = evaluateCampaignQuality(reports);
  const ordered = [...reports].sort((a, b) =>
    (a.caseId + ":" + a.trial + ":" + a.arm).localeCompare(
      b.caseId + ":" + b.trial + ":" + b.arm,
    ),
  );
  let blockers = gate.blockers.length;
  if (new Set(reports.map((report) => report.runId)).size !== reports.length)
    blockers++;
  if (
    reports.some(
      (report) =>
        report.requestedModel?.provider !== preference.provider ||
        report.requestedModel?.id !== preference.model ||
        JSON.stringify(report.servingModelApis) !==
          JSON.stringify([preference.api]),
    )
  )
    blockers++;
  if (
    reports.some(
      (report) =>
        JSON.stringify(report.taskPhases) !==
        JSON.stringify([preference.taskPhase]),
    )
  )
    blockers++;
  if (
    new Set(
      candidate.map((report) =>
        JSON.stringify([
          report.fixtureSha256,
          report.promptSha256,
          report.outcomeSha256,
        ]),
      ),
    ).size < gate.cases
  )
    blockers++;
  const counts = new Map();
  for (const report of candidate)
    counts.set(report.caseId, (counts.get(report.caseId) ?? 0) + 1);
  const observed = candidate.filter(
    (report) =>
      report.editOperationEvidence?.complete === true &&
      report.editOperationEvidence.operations.some(
        (call) =>
          call.status === "completed" &&
          call.operation === operation[preference.dialect] &&
          /^[a-f0-9]{64}$/u.test(call.sourceCapsuleSha256 ?? ""),
      ),
  ).length;
  return {
    id,
    preference,
    profile: first.profile,
    runtimeArtifactSha256: first.runtimeArtifactSha256,
    reportSetSha256: hash(ordered),
    gateSha256: gate.contentSha256,
    assessment: {
      cases: gate.cases,
      minimumPairedTrials: counts.size ? Math.min(...counts.values()) : 0,
      comparablePairs: gate.comparablePairs,
      candidateFormatObserved: observed,
      regressions: gate.regressions.length,
      blockers,
    },
  };
}
