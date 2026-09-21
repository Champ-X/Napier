import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { calibrationEntryFromReports } from "./edit-format-calibration-evidence.mjs";
import { dependencyGraphReceipt } from "./harness-runtime-dependencies.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
function environmentEvidence(runId) {
  const content = {
    kind: "napier.harness-environment-evidence",
    schemaVersion: 1,
    runId,
    sandboxId: "host-direct",
    configurationSha256: hash("configuration"),
    valid: true,
    eligible: true,
    executionMode: "standard",
    missingTools: [],
    receipts: [],
    blockers: [],
  };
  return { ...content, contentSha256: hash(JSON.stringify(content)) };
}
function reports() {
  const preference = {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    api: "openai-completions",
    taskPhase: "coding",
    dialect: "unified_diff",
  };
  return ["baseline", "candidate"].flatMap((arm) =>
    [0, 1, 2].map((trial) => ({
      arm,
      trial,
      caseId: "shipping",
      runId: arm + trial,
      qualifyingEvidence: true,
      runtimeArtifactStable: true,
      sourceStable: true,
      servingIdentityMatched: true,
      runtimeArtifactSha256: hash("runtime"),
      runtimeDependencyEvidence: dependencyGraphReceipt(
        {
          contentSha256: hash("dependencies"),
          eligible: true,
          packages: [{}],
          fileCount: 1,
        },
        undefined,
        arm + trial,
      ),
      sourceIdentity: { source: hash("source") },
      fixtureSha256: hash("fixture"),
      promptSha256: hash("prompt"),
      outcomeSha256: hash("grader"),
      memorySeedSha256: null,
      campaignScriptSha256: hash("script"),
      campaignHelperSha256: hash("helper"),
      requestedModel: { provider: preference.provider, id: preference.model },
      servingModelApis: [preference.api],
      taskPhases: ["coding"],
      sandbox: "host-direct",
      environmentEvidence: environmentEvidence(arm + trial),
      taskSuccess: true,
      allowedChanges: true,
      status: "completed",
      profile: {
        contentSha256: hash(arm),
        policies: { toolSurface: { editPreference: preference } },
      },
      editOperationEvidence: {
        complete: true,
        operations: [
          {
            operation: "unified_diff",
            status: "completed",
            sourceCapsuleSha256: hash("capsule"),
          },
        ],
      },
    })),
  );
}
it("retains original report hashes and keeps a three-trial format exercise below qualification", () => {
  const observations = reports();
  const entry = calibrationEntryFromReports("pilot", observations);
  expect(entry.assessment).toMatchObject({
    cases: 1,
    minimumPairedTrials: 3,
    comparablePairs: 3,
    candidateFormatObserved: 3,
  });
  expect(entry.assessment.blockers).toBeGreaterThan(0);
  expect(
    calibrationEntryFromReports("pilot", observations.toReversed())
      .reportSetSha256,
  ).toBe(entry.reportSetSha256);
  observations[3].taskSuccess = false;
  const regressed = calibrationEntryFromReports("pilot", observations);
  expect(regressed.assessment.regressions).toBeGreaterThan(0);
  expect(regressed.reportSetSha256).not.toBe(entry.reportSetSha256);
});
it("does not substitute available formats or unknown capsules for actual format usage", () => {
  const observations = reports();
  observations[3].editOperationEvidence.operations[0].operation = "replace";
  observations[4].editOperationEvidence.complete = false;
  observations[5].editOperationEvidence.operations[0].sourceCapsuleSha256 = "";
  expect(
    calibrationEntryFromReports("pilot", observations).assessment
      .candidateFormatObserved,
  ).toBe(0);
});
it("rejects API/task mismatches and reused Run evidence as qualification blockers", () => {
  const observations = reports();
  const first = calibrationEntryFromReports("pilot", observations);
  observations[3].servingModelApis = ["other"];
  observations[4].taskPhases = ["research"];
  observations[5].runId = observations[0].runId;
  expect(
    calibrationEntryFromReports("pilot", observations).assessment.blockers,
  ).toBeGreaterThanOrEqual(first.assessment.blockers + 3);
});
it("format adoption without environment evidence cannot qualify calibration", () => {
  const observations = reports();
  for (const report of observations) delete report.environmentEvidence;
  expect(
    calibrationEntryFromReports("pilot", observations).assessment,
  ).toMatchObject({
    comparablePairs: 0,
    cases: 0,
    candidateFormatObserved: 3,
  });
});
