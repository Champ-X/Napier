import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { evaluateCampaignQuality } from "./harness-campaign-evidence.mjs";
import { dependencyGraphReceipt } from "./harness-runtime-dependencies.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
function report(arm, caseId, trial, input = caseId) {
  const runId = `run_${arm}_${caseId}_${trial}`;
  const environment = {
    kind: "napier.harness-environment-evidence",
    schemaVersion: 1,
    runId,
    sandboxId: "test",
    configurationSha256: hash("configuration"),
    valid: true,
    eligible: true,
    executionMode: "standard",
    missingTools: [],
    receipts: [],
    blockers: [],
  };
  return {
    arm,
    caseId,
    trial,
    runId,
    qualifyingEvidence: true,
    runtimeArtifactStable: true,
    sourceStable: true,
    servingIdentityMatched: true,
    runtimeArtifactSha256: hash(arm),
    runtimeDependencyEvidence: dependencyGraphReceipt(
      {
        contentSha256: hash(arm + "dependencies"),
        eligible: true,
        packages: [{}],
        fileCount: 1,
      },
      undefined,
      runId,
    ),
    sourceIdentity: { nodeVersion: process.version },
    taskSuccess: true,
    allowedChanges: true,
    status: "completed",
    fixtureSha256: hash(input),
    promptSha256: hash("prompt"),
    outcomeSha256: hash("grader"),
    acceptanceSha256: hash("acceptance"),
    memorySeedSha256: null,
    requestedModel: { provider: "test", id: "test" },
    sandbox: "test",
    profile: null,
    environmentEvidence: {
      ...environment,
      contentSha256: hash(JSON.stringify(environment)),
    },
  };
}
function campaign(inputFor = (id) => id) {
  return Array.from({ length: 30 }, (_, i) => `case_${i}`).flatMap((id) =>
    [0, 1, 2].flatMap((trial) =>
      ["baseline", "candidate"].map((arm) =>
        report(arm, id, trial, inputFor(id)),
      ),
    ),
  );
}

test("thirty distinct captured tasks with three independent paired trials satisfy the default gate", () => {
  const result = evaluateCampaignQuality(campaign());
  assert.equal(result.promotionReady, true);
  assert.equal(result.cases, 30);
  assert.equal(result.comparablePairs, 90);
});

test("renaming one task thirty times cannot satisfy distinct-case requirements", () => {
  const result = evaluateCampaignQuality(campaign(() => "same-task"));
  assert.equal(result.promotionReady, false);
  assert.ok(result.cases < 30);
});

test("different graders do not turn the same task inputs into independent cases", () => {
  const reports = campaign(() => "same-task");
  for (const r of reports) r.outcomeSha256 = hash(r.caseId);
  assert.equal(evaluateCampaignQuality(reports).promotionReady, false);
});

test("reusing a Run under new trial labels cannot satisfy replication requirements", () => {
  const reports = campaign();
  for (const r of reports) {
    const original = report(r.arm, r.caseId, 0);
    r.runId = original.runId;
    r.environmentEvidence = original.environmentEvidence;
    r.runtimeDependencyEvidence = original.runtimeDependencyEvidence;
  }
  const result = evaluateCampaignQuality(reports);
  assert.equal(result.promotionReady, false);
  assert.ok(result.comparablePairs < 90);
});

test("changing a case contract between trials cannot count as repeated trials of that case", () => {
  const reports = campaign();
  for (const r of reports)
    if (r.caseId === "case_0" && r.trial === 2)
      r.promptSha256 = hash("changed contract");
  assert.equal(evaluateCampaignQuality(reports).promotionReady, false);
});

test("invalid trial identifiers and missing task hashes cannot inflate sample size", () => {
  for (const change of [
    (r) => {
      r.trial = -1;
    },
    (r) => {
      r.fixtureSha256 = undefined;
    },
  ]) {
    const reports = campaign();
    for (const r of reports)
      if (r.caseId === "case_0" && r.trial === 0) change(r);
    assert.equal(evaluateCampaignQuality(reports).promotionReady, false);
  }
});

test("invalid sample identity does not conceal an observed adverse candidate outcome", () => {
  const reports = campaign(() => "same-task");
  reports[1].taskSuccess = false;
  const result = evaluateCampaignQuality(reports);
  assert.equal(result.verdict, "regressed");
  assert.ok(result.blockers.length > 0);
});

test("Run reuse across arms or cases invalidates every affected pair", () => {
  for (const target of [1, 6]) {
    const reports = campaign();
    reports[target].runId = reports[0].runId;
    const result = evaluateCampaignQuality(reports);
    assert.equal(result.promotionReady, false);
    assert.ok(result.blockers.some((value) => value.includes("reused Run")));
    assert.equal(result.comparablePairs, target === 1 ? 89 : 88);
  }
});

test("malformed identifiers and supplied optional hashes fail qualification", () => {
  for (const patch of [
    { runId: " " },
    { caseId: "" },
    { trial: "0" },
    { trial: 0.5 },
    { trial: Number.MAX_SAFE_INTEGER + 1 },
    { promptSha256: "bad" },
    { outcomeSha256: null },
    { memorySeedSha256: "bad" },
    { acceptanceSha256: 1 },
  ]) {
    const reports = campaign();
    Object.assign(reports[0], patch);
    Object.assign(reports[1], patch);
    const result = evaluateCampaignQuality(reports);
    assert.equal(result.promotionReady, false);
    assert.ok(
      result.blockers.some((value) =>
        value.includes("invalid sample identity"),
      ),
    );
  }
});

test("grader and acceptance changes invalidate all repetitions of a case", () => {
  for (const field of ["outcomeSha256", "acceptanceSha256"]) {
    const reports = campaign();
    reports[0][field] = reports[1][field] = hash("changed");
    const result = evaluateCampaignQuality(reports);
    assert.equal(result.comparablePairs, 87);
    assert.equal(result.cases, 29);
  }
});

test("captured memory seeds are task inputs and legacy absent optional hashes remain valid", () => {
  const reports = campaign(() => "same fixture and prompt");
  for (const r of reports) {
    r.memorySeedSha256 = hash(r.caseId);
    delete r.acceptanceSha256;
  }
  assert.equal(evaluateCampaignQuality(reports).promotionReady, true);
});
