import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const analysisDigest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
export const campaignCell = ({ caseId, trial, arm }) =>
  `${caseId}:${trial}:${arm}`;
const engine = () =>
  import("../packages/harness-eval/dist/harness-experiments.js");

async function evaluatorDigest() {
  const files = [
    "harness-campaign-analysis-plan.mjs",
    "harness-campaign-analysis.mjs",
    "harness-campaign-evidence.mjs",
    "harness-sample-identity.mjs",
    "harness-grader-evidence.mjs",
    "harness-environment-evidence.mjs",
    "harness-runtime-dependencies.mjs",
    "harness-api-request-budget.mjs",
    ...["definition", "analysis", "family-summary"].map(
      (part) => `../packages/harness-eval/dist/harness-experiment-${part}.js`,
    ),
  ];
  return analysisDigest(
    await Promise.all(
      files.map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(new URL(file, import.meta.url)))
          .digest("hex"),
      ]),
    ),
  );
}

/** Freeze rules, input identities, profiles and the existing scheduler's order
 * before launching any model request. Historical reports cannot acquire this binding. */
export async function prepareCampaignAnalysis({
  spec,
  inputs,
  jobs,
  profiles,
}) {
  const { createHarnessExperiment } = await engine();
  assert.ok(
    profiles.baseline && profiles.candidate,
    "Analysis requires explicit profiles for both arms",
  );
  const readProfile = async (receipt) => {
    const bytes = await readFile(receipt.path);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      receipt.fileSha256,
      "Frozen profile changed",
    );
    return JSON.parse(bytes);
  };
  const cases = [];
  for (const item of inputs.cases) {
    assert.ok(
      item.taskFamily && item.partition,
      "Analysis requires declared task families and partitions",
    );
    const manifest = JSON.parse(
      await readFile(path.join(item.path, "manifest.json"), "utf8"),
    );
    const fixture = Object.fromEntries(
      Object.entries(item.files)
        .filter(([file]) => file.startsWith(`${manifest.fixturePath}/`))
        .map(([file, digest]) => [
          file.slice(manifest.fixturePath.length + 1),
          digest,
        ]),
    );
    cases.push({
      id: item.id,
      inputSha256: item.inputSha256,
      promptSha256: item.files[manifest.promptPath],
      outcomeSha256: item.files[manifest.outcomeTestPath],
      fixtureSha256: analysisDigest(fixture),
      memorySeedSha256: item.files[manifest.memorySeedPath] ?? null,
    });
  }
  const experiment = createHarnessExperiment({
    ...spec,
    baselineProfile: await readProfile(profiles.baseline),
    candidateProfile: await readProfile(profiles.candidate),
    cases: inputs.cases.map((item) => ({
      id: item.id,
      inputSha256: item.inputSha256,
      tags: item.coverage,
      taskFamily: item.taskFamily,
      partition: item.partition,
    })),
    seeds: [...new Set(jobs.map((job) => job.trial))],
  });
  const content = {
    kind: "napier.harness-campaign-analysis-plan",
    schemaVersion: 1,
    experiment,
    evaluatorSha256: await evaluatorDigest(),
    cases,
    inputReceiptSha256: analysisDigest(inputs),
    schedule: jobs.map(({ caseId, trial, arm }) => ({ caseId, trial, arm })),
  };
  return validateCampaignAnalysisPlan({
    ...content,
    contentSha256: analysisDigest(content),
  });
}

export async function validateCampaignAnalysisPlan(plan) {
  const { validateHarnessExperiment } = await engine();
  assert.equal(plan.kind, "napier.harness-campaign-analysis-plan");
  assert.equal(plan.schemaVersion, 1);
  const { contentSha256, ...content } = plan;
  assert.equal(
    analysisDigest(content),
    contentSha256,
    "Campaign analysis plan hash changed",
  );
  assert.equal(
    plan.evaluatorSha256,
    await evaluatorDigest(),
    "Campaign evaluator changed after preregistration",
  );
  const experiment = validateHarnessExperiment(plan.experiment);
  assert.ok(
    experiment.analysis,
    "Historical experiments cannot qualify a new campaign",
  );
  assert.deepEqual(
    plan.cases.map((item) => item.id).sort(),
    experiment.cases.map((item) => item.id).sort(),
  );
  assert.match(plan.inputReceiptSha256, /^[a-f0-9]{64}$/u);
  for (const item of plan.cases) {
    assert.equal(
      item.inputSha256,
      experiment.cases.find((entry) => entry.id === item.id).inputSha256,
    );
    for (const field of [
      "inputSha256",
      "promptSha256",
      "outcomeSha256",
      "fixtureSha256",
    ])
      assert.match(item[field], /^[a-f0-9]{64}$/u);
    if (item.memorySeedSha256 !== null)
      assert.match(item.memorySeedSha256, /^[a-f0-9]{64}$/u);
  }
  const expected = experiment.cases
    .flatMap((item) =>
      experiment.seeds.flatMap((trial) =>
        ["baseline", "candidate"].map((arm) =>
          campaignCell({ caseId: item.id, trial, arm }),
        ),
      ),
    )
    .sort();
  assert.deepEqual(
    plan.schedule.map(campaignCell).sort(),
    expected,
    "Schedule must retain every original cell exactly once",
  );
  let ab = 0,
    ba = 0;
  for (let i = 0; i < plan.schedule.length; i += 2) {
    const first = plan.schedule[i],
      second = plan.schedule[i + 1];
    assert.equal(first.caseId, second.caseId);
    assert.equal(first.trial, second.trial);
    assert.notEqual(first.arm, second.arm);
    first.arm === "baseline" ? ab++ : ba++;
  }
  assert.ok(
    Math.abs(ab - ba) <= 1,
    "Analysis requires balanced AB/BA scheduling",
  );
  return plan;
}

export async function readCampaignAnalysisPlan(file, expectedHash) {
  const plan = await validateCampaignAnalysisPlan(
    JSON.parse(await readFile(file, "utf8")),
  );
  assert.equal(
    plan.contentSha256,
    expectedHash,
    "Campaign analysis plan differs from dispatch",
  );
  return plan;
}

/** Called by the real campaign child before model execution. */
export function bindCampaignAnalysisJob({
  plan,
  position,
  caseId,
  trial,
  arm,
  model,
  profile,
  inputs,
}) {
  assert.ok(Number.isSafeInteger(position) && position >= 0);
  assert.deepEqual(
    plan.schedule[position],
    { caseId, trial, arm },
    "Analysis schedule address differs from child",
  );
  const definition = plan.experiment;
  assert.deepEqual(
    model,
    definition.modelRouteLock.servingModel,
    "Analysis model lock differs from child",
  );
  assert.equal(
    profile?.contentSha256,
    definition[`${arm}Profile`].contentSha256,
    "Analysis profile differs from child",
  );
  const item = plan.cases.find((item) => item.id === caseId);
  for (const field of [
    "fixtureSha256",
    "promptSha256",
    "outcomeSha256",
    "memorySeedSha256",
  ])
    assert.equal(
      inputs[field] ?? null,
      item[field] ?? null,
      `Analysis input differs: ${field}`,
    );
  return {
    planSha256: plan.contentSha256,
    experimentSha256: definition.contentSha256,
    schedulePosition: position,
    caseInputSha256: item.inputSha256,
  };
}
