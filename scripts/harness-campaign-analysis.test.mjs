import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, test } from "vitest";
import { createModelHarnessExperimentProfile } from "../packages/harness-eval/dist/harness-experiments.js";
import { prepareHarnessSuite } from "./harness-suite.mjs";
import { pairedSuiteJobs } from "./harness-paired-schedule.mjs";
import { observation } from "./harness-campaign-test-fixture.mjs";
import { collectUsageEvidence } from "./harness-usage-evidence.mjs";
import { evaluateCampaignQuality } from "./harness-campaign-evidence.mjs";
import { evaluateCampaignAnalysis } from "./harness-campaign-analysis.mjs";
import {
  analysisDigest,
  bindCampaignAnalysisJob,
  prepareCampaignAnalysis,
  readCampaignAnalysisPlan,
} from "./harness-campaign-analysis-plan.mjs";

let root, inputs, jobs, profiles, plan, reports, statuses;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const spec = {
  id: "campaign-protocol-test",
  modelRouteLock: {
    role: "default",
    servingModel: { provider: "fixture", id: "fixed" },
    fallbackSamples: "separate_stratum",
  },
  primaryMetrics: ["task_success", "duration_ms"],
  guardrailMetrics: ["false_completion", "intervention_count"],
  analysis: {
    evidenceKind: "contract_fixture",
    metrics: {
      duration_ms: {
        unit: "milliseconds",
        direction: "lower",
        nonInferiorityMargin: 0,
        minimumEffectiveDifference: 5,
      },
    },
  },
};

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "napier-campaign-analysis-"));
  const cases = [];
  for (let i = 0; i < 30; i++) {
    const id = `case_${i}`,
      dir = path.join(root, id);
    await mkdir(path.join(dir, "fixture"), { recursive: true });
    await writeFile(path.join(dir, "fixture/input.txt"), id);
    await writeFile(path.join(dir, "prompt.md"), `Synthetic task ${id}`);
    await writeFile(
      path.join(dir, "outcome.mjs"),
      "// contract fixture, no live outcome",
    );
    await writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        id,
        fixturePath: "fixture",
        promptPath: "prompt.md",
        outcomeTestPath: "outcome.mjs",
      }),
    );
    cases.push({
      path: id,
      coverage: ["coding"],
      taskFamily: `family-${i}`,
      partition: i < 10 ? "tuning" : i < 20 ? "regression" : "holdout",
    });
  }
  const suitePath = path.join(root, "suite.json");
  await writeFile(
    suitePath,
    JSON.stringify({
      kind: "napier.harness-optimization-suite",
      schemaVersion: 1,
      id: "analysis_fixture",
      cases,
    }),
  );
  inputs = await prepareHarnessSuite(suitePath, path.join(root, "inputs"));
  jobs = pairedSuiteJobs(inputs.cases, path.join(root, "output"), 3);
  profiles = {};
  for (const [arm, maxActiveTools] of [
    ["baseline", 20],
    ["candidate", 12],
  ]) {
    const profile = createModelHarnessExperimentProfile({
      id: `${arm}-v1`,
      maxActiveTools,
    });
    const bytes = JSON.stringify(profile),
      file = path.join(root, `${arm}.json`);
    await writeFile(file, bytes);
    profiles[arm] = {
      path: file,
      fileSha256: hash(bytes),
      profileSha256: profile.contentSha256,
    };
  }
  plan = await prepareCampaignAnalysis({ spec, inputs, jobs, profiles });
  reports = plan.schedule.map((job, position) => {
    const item = plan.cases.find((item) => item.id === job.caseId),
      profile = plan.experiment[`${job.arm}Profile`];
    const report = observation(job.arm, {
      ...job,
      profile,
      requestedModel: spec.modelRouteLock.servingModel,
      fixtureSha256: item.fixtureSha256,
      promptSha256: item.promptSha256,
      outcomeSha256: item.outcomeSha256,
      memorySeedSha256: item.memorySeedSha256,
      evidenceKind: "contract_fixture",
      graderExitCode: 0,
      durationMs: job.arm === "baseline" ? 100 : 80,
      interventionCount: 0,
    });
    report.analysisBinding = bindCampaignAnalysisJob({
      plan,
      position,
      ...job,
      model: report.requestedModel,
      profile,
      inputs: item,
    });
    report.usage = {
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: job.arm === "baseline" ? 2 : 1,
    };
    report.usageEvidence = collectUsageEvidence(
      { id: report.runId, usage: report.usage },
      [
        {
          id: `response-${report.runId}`,
          runId: report.runId,
          type: "model.response",
          payload: { usage: report.usage },
        },
      ],
    );
    return report;
  });
  statuses = jobs.map((job) => ({
    job,
    status: "settled",
    result: { exitCode: 0 },
  }));
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

test("freezes the real suite inputs, rules, profiles and existing paired schedule", async () => {
  assert.equal(plan.schedule.length, 180);
  assert.equal(
    plan.experiment.cases.filter((item) => item.partition === "holdout").length,
    10,
  );
  const file = path.join(root, "plan.json");
  await writeFile(file, JSON.stringify(plan));
  assert.deepEqual(
    await readCampaignAnalysisPlan(file, plan.contentSha256),
    plan,
  );
  await assert.rejects(
    readCampaignAnalysisPlan(file, "0".repeat(64)),
    /differs from dispatch/,
  );
  const changed = JSON.parse(await readFile(file, "utf8"));
  changed.experiment.analysis.metrics.task_success.nonInferiorityMargin = 1;
  await writeFile(file, JSON.stringify(changed));
  await assert.rejects(
    readCampaignAnalysisPlan(file, plan.contentSha256),
    /hash changed/,
  );
  const { contentSha256: _hash, ...drifted } = structuredClone(plan);
  drifted.evaluatorSha256 = "0".repeat(64);
  const rebound = { ...drifted, contentSha256: analysisDigest(drifted) };
  await writeFile(file, JSON.stringify(rebound));
  await assert.rejects(
    readCampaignAnalysisPlan(file, rebound.contentSha256),
    /evaluator changed/,
  );
});

test("child rejects wrong position, profile, model or task before model execution", () => {
  const job = plan.schedule[0],
    item = plan.cases.find((item) => item.id === job.caseId);
  const request = {
    plan,
    position: 0,
    ...job,
    model: spec.modelRouteLock.servingModel,
    profile: plan.experiment[`${job.arm}Profile`],
    inputs: item,
  };
  assert.throws(
    () => bindCampaignAnalysisJob({ ...request, position: 1 }),
    /address differs/,
  );
  assert.throws(
    () => bindCampaignAnalysisJob({ ...request, profile: {} }),
    /profile differs/,
  );
  assert.throws(
    () =>
      bindCampaignAnalysisJob({
        ...request,
        model: { provider: "other", id: "fixed" },
      }),
    /model lock differs/,
  );
  assert.throws(
    () =>
      bindCampaignAnalysisJob({
        ...request,
        inputs: { ...item, promptSha256: hash("changed") },
      }),
    /input differs/,
  );
});

test("sample gate and statistically improved fixtures still cannot promote live quality", async () => {
  const quality = evaluateCampaignQuality(reports);
  assert.equal(quality.qualityGatePassed, true);
  assert.equal(quality.promotionReady, false);
  const result = await evaluateCampaignAnalysis({ plan, reports, statuses });
  assert.equal(result.evaluation.verdict, "improved");
  assert.equal(result.claimScope, "contract_only");
  assert.equal(result.promotionReady, false);
  assert.equal(result.reportBindings.length, 180);
  assert.ok(result.blockers.includes("evidence_does_not_support_live_quality"));
  assert.equal(
    result.evaluation.families.find((item) => item.arm === "candidate")
      .costPerSuccessUsd,
    1,
  );
  assert.equal(
    result.evaluation.families.find((item) => item.arm === "candidate")
      .interventionRate,
    0,
  );
});

test("historical reports cannot be retroactively relabelled as preregistered evidence", async () => {
  const historical = structuredClone(reports);
  for (const report of historical) delete report.analysisBinding;
  const result = await evaluateCampaignAnalysis({
    plan,
    reports: historical,
    statuses,
  });
  assert.equal(result.promotionReady, false);
  assert.equal(
    result.blockers.filter((reason) => reason.includes("analysis binding"))
      .length,
    180,
  );
});

test("qualification requires bound live evidence and excludes the tuning partition", async () => {
  // These synthetic inputs exercise the decision contract, not actual live quality.
  const liveSpec = {
    ...spec,
    analysis: { ...spec.analysis, evidenceKind: "live_model" },
    modelRouteLock: {
      ...spec.modelRouteLock,
      servingModel: { provider: "deepseek", id: "deepseek-v4-flash" },
    },
  };
  for (const includeTuning of [true, false]) {
    const declared = structuredClone(inputs);
    if (!includeTuning)
      declared.cases.forEach((item) => {
        if (item.partition === "tuning") item.partition = "regression";
      });
    const bound = await prepareCampaignAnalysis({
      spec: liveSpec,
      inputs: declared,
      jobs,
      profiles,
    });
    const observations = structuredClone(reports);
    for (const [position, report] of observations.entries()) {
      report.evidenceKind = "live_model";
      report.requestedModel = liveSpec.modelRouteLock.servingModel;
      report.analysisBinding = bindCampaignAnalysisJob({
        plan: bound,
        position,
        ...bound.schedule[position],
        model: report.requestedModel,
        profile: report.profile,
        inputs: bound.cases.find((item) => item.id === report.caseId),
      });
    }
    const result = await evaluateCampaignAnalysis({
      plan: bound,
      reports: observations,
      statuses,
    });
    assert.equal(result.promotionReady, !includeTuning);
    assert.deepEqual(
      result.blockers,
      includeTuning ? ["tuning_partition_is_not_qualification"] : [],
    );
    assert.equal(result.claimScope, "live_quality");
  }
});

test("retains failed, missing and source-drifted observations without best retry", async () => {
  const changed = structuredClone(reports);
  const candidate = changed.find((report) => report.arm === "candidate");
  candidate.taskSuccess = false;
  candidate.graderExitCode = 1;
  candidate.runtimeArtifactSha256 = hash("drift");
  changed.pop();
  const incomplete = structuredClone(statuses);
  incomplete.at(-1).status = "not_started";
  const result = await evaluateCampaignAnalysis({
    plan,
    reports: changed,
    statuses: incomplete,
  });
  assert.equal(result.evaluation.verdict, "insufficient_evidence");
  assert.ok(result.quality.regressions.length > 0);
  assert.equal(result.evaluation.missingPairCount, 1);
  assert.equal(
    result.evaluation.families.find(
      (item) => item.taskFamily === "family-0" && item.arm === "candidate",
    ).falseCompletionRate,
    1 / 3,
  );
  assert.ok(
    result.blockers.some((reason) =>
      reason.includes("source or profile changed"),
    ),
  );
  await assert.rejects(
    evaluateCampaignAnalysis({
      plan,
      reports: [...reports, reports[0]],
      statuses,
    }),
    /Duplicate campaign observation/,
  );
});

test("missing or tampered usage stays unknown, never zero cost", async () => {
  const changed = structuredClone(reports);
  changed[0].usageEvidence.observedUsage.costUsd = 500;
  const result = await evaluateCampaignAnalysis({
    plan,
    reports: changed,
    statuses,
  });
  assert.equal(
    result.evaluation.families.find(
      (item) => item.taskFamily === "family-0" && item.arm === "baseline",
    ).costPerSuccessUsd,
    null,
  );
});

test("refuses missing partition declarations and fixed AB schedules before dispatch", async () => {
  const undeclared = structuredClone(inputs);
  delete undeclared.cases[0].partition;
  await assert.rejects(
    prepareCampaignAnalysis({ spec, inputs: undeclared, jobs, profiles }),
    /declared task families/,
  );
  const abOnly = jobs.flatMap((job, index) =>
    index % 2
      ? []
      : jobs
          .slice(index, index + 2)
          .sort((a) => (a.arm === "baseline" ? -1 : 1)),
  );
  await assert.rejects(
    prepareCampaignAnalysis({ spec, inputs, jobs: abOnly, profiles }),
    /balanced AB\/BA/,
  );
});

test("real suite CLI freezes analysis before 180 synthetic child runs and saves scoped results", async () => {
  const cli = path.join(root, "cli");
  await mkdir(cli);
  await cp(path.resolve("scripts"), path.join(cli, "scripts"), {
    recursive: true,
  });
  await symlink(path.resolve("packages"), path.join(cli, "packages"));
  await symlink(path.resolve("node_modules"), path.join(cli, "node_modules"));
  // Exercise the actual parent CLI, SQLite admission setup and child preflight.
  // Only the model-using child body is replaced; these are explicit fixtures.
  await writeFile(
    path.join(cli, "scripts/run-harness-optimization-campaign.mjs"),
    String.raw`
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { observation } from "./harness-campaign-test-fixture.mjs";
import { readCampaignAnalysisPlan, bindCampaignAnalysisJob } from "./harness-campaign-analysis-plan.mjs";
const args=process.argv.slice(2), get=(name)=>args[args.indexOf('--'+name)+1];
const plan=await readCampaignAnalysisPlan(get('analysis-plan'),get('analysis-plan-sha256'));
const position=Number(get('schedule-position')), job=plan.schedule[position];
const profile=JSON.parse(await readFile(get('profile-file'),'utf8'));
const item=plan.cases.find((item)=>item.id===job.caseId);
const model=plan.experiment.modelRouteLock.servingModel;
const analysisBinding=bindCampaignAnalysisJob({plan,position,...job,model,profile,inputs:item});
const report=observation(job.arm,{...job,profile,requestedModel:model,evidenceKind:'contract_fixture',
  analysisBinding,fixtureSha256:item.fixtureSha256,promptSha256:item.promptSha256,
  outcomeSha256:item.outcomeSha256,memorySeedSha256:item.memorySeedSha256,
  graderExitCode:0,durationMs:job.arm==='baseline'?100:80,interventionCount:0});
const output=path.join(get('output'),'trial-'+(job.trial+1));
await mkdir(output,{recursive:true});
await writeFile(path.join(output,'result.json'),JSON.stringify(report),{flag:'wx'});
`,
  );
  const protocolFile = path.join(root, "protocol.json"),
    output = path.join(root, "cli-output");
  await writeFile(protocolFile, JSON.stringify(spec));
  const child = spawnSync(
    process.execPath,
    [
      path.join(cli, "scripts/run-harness-optimization-suite.mjs"),
      "--suite",
      path.join(root, "suite.json"),
      "--output",
      output,
      "--baseline-runtime",
      process.cwd(),
      "--candidate-runtime",
      process.cwd(),
      "--baseline-profile-file",
      profiles.baseline.path,
      "--candidate-profile-file",
      profiles.candidate.path,
      "--analysis-protocol",
      protocolFile,
      "--max-api-requests",
      "1000",
      "--api-request-interval-ms",
      "0",
    ],
    { encoding: "utf8", timeout: 30000, env: { PATH: process.env.PATH } },
  );
  assert.equal(child.status, 0, child.stderr);
  const schedule = JSON.parse(
    await readFile(path.join(output, "schedule.json"), "utf8"),
  );
  const frozen = JSON.parse(
    await readFile(path.join(output, "analysis-plan.json"), "utf8"),
  );
  const result = JSON.parse(
    await readFile(path.join(output, "suite-result.json"), "utf8"),
  );
  assert.equal(result.collectionComplete, true);
  assert.equal(result.observations.length, 180);
  assert.equal(result.analysis.planSha256, frozen.contentSha256);
  assert.equal(schedule.analysisPlanSha256, frozen.contentSha256);
  assert.equal(result.analysis.evaluation.verdict, "improved");
  assert.equal(result.analysis.claimScope, "contract_only");
  assert.equal(result.promotionReady, false);
  assert.equal(result.apiRequestBudget.admitted, 0);
  assert.equal(result.quality.qualityGatePassed, true);
}, 35000);
