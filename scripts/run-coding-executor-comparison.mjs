import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createLocalAgentRuntime,
  createWorkspacePathSnapshot,
  diffWorkspaceSnapshots,
} from "../packages/runtime/dist/index.js";
import {
  codingBenchmarkTargetEvidence,
  copyCodingBenchmarkFixture,
  loadCodingBenchmarkCase,
} from "../apps/cli/dist/coding-benchmark-case.js";
import { runCodingBenchmark } from "../apps/cli/dist/coding-benchmark.js";
import {
  calculateCodingExecutorComparisonSummary,
  verifyCodingExecutorComparison,
} from "./check-coding-executor-comparison.mjs";
import {
  directComparisonSandbox,
  normalizeOmpUsage,
  runComparisonProcess,
  zeroComparisonUsage,
} from "./coding-executor-comparison-process.mjs";
import { generateCodingComparisonSuite } from "./generate-coding-comparison-suite.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const REPORT_TYPE = "napier.executor-comparison-calibration";
const MODEL = { provider: "deepseek", id: "deepseek-v4-flash" };

export async function runCodingExecutorComparison(options) {
  validateOptions(options);
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "napier-executor-comparison-"),
  );
  try {
    const ompVersion = await probeOmpVersion(options.ompExecutable);
    const suiteRoot = path.join(temporaryRoot, "suite");
    const suite = await generateCodingComparisonSuite({
      outputDir: suiteRoot,
      seed: options.seed,
      profile: options.profile,
    });
    const cases = [];
    for (let caseIndex = 0; caseIndex < suite.cases.length; caseIndex += 1) {
      const entry = suite.cases[caseIndex];
      const caseRoot = path.join(suiteRoot, entry.directory);
      const trials = [];
      for (let trial = 1; trial <= options.trialCount; trial += 1) {
        const ompFirst = (caseIndex + trial) % 2 === 0;
        let napier;
        let omp;
        if (ompFirst) {
          omp = await runOmpTrial(options, caseRoot, temporaryRoot, trial);
          napier = await runNapierTrial(
            options,
            caseRoot,
            temporaryRoot,
            trial,
          );
        } else {
          napier = await runNapierTrial(
            options,
            caseRoot,
            temporaryRoot,
            trial,
          );
          omp = await runOmpTrial(options, caseRoot, temporaryRoot, trial);
        }
        trials.push({ trial, napier, omp });
      }
      cases.push(createCaseReport(entry, trials, options.trialCount));
    }
    const environment = {
      platform: process.platform,
      architecture: process.arch,
      nestedSandboxAvailable: options.trustedOuterSandbox,
      trustedOuterSandboxCalibration: options.trustedOuterSandbox,
      ompVersion,
      notes: [
        "All generated cases passed hash-bound loader validation.",
        "Both executors used isolated workspaces and counterbalanced execution order.",
        ...(options.trustedOuterSandbox
          ? [
              "Napier process tools used a test-only direct adapter inside the trusted outer Sandbox.",
            ]
          : ["Napier used its production platform Sandbox adapter."]),
      ],
    };
    const calculated = calculateCodingExecutorComparisonSummary(
      environment,
      cases,
    );
    const report = {
      type: REPORT_TYPE,
      schemaVersion: 1,
      taskSelection: {
        source: "seeded structural coding benchmark generator",
        seed: options.seed,
        profile: options.profile,
        suiteSha256: suite.contentSha256,
        samePrompt: true,
        sameFixture: true,
        sameHiddenOutcomeTest: true,
        externalTimeoutMs: options.timeoutMs,
      },
      environment,
      model: MODEL,
      cases,
      summary: {
        ...calculated,
        requiredFollowUps: [
          "Repeat structural families across additional seeds and models.",
          "Retain OMP token and cost metrics only when its machine output exposes stable usage.",
          "Repeat outside nested IDE isolation before making a production Sandbox claim.",
        ],
      },
    };
    const verification = await verifyCodingExecutorComparison(report);
    if (!verification.valid) {
      throw new Error(
        `Generated coding comparison report is invalid: ${verification.errors.join(",")}`,
      );
    }
    await writeJson(options.outputPath, report);
    return { report, verification };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function runNapierTrial(options, caseRoot, temporaryRoot, trial) {
  const startedAt = performance.now();
  try {
    const dependencies = options.trustedOuterSandbox
      ? {
          now: () => new Date(),
          createRuntime: (runtimeOptions) =>
            createLocalAgentRuntime({
              ...runtimeOptions,
              sandbox: directComparisonSandbox(),
            }),
        }
      : undefined;
    const artifacts = await runCodingBenchmark(
      {
        caseRoot,
        outputDir: path.join(temporaryRoot, `napier-trial-${trial}`),
        model: MODEL,
        env: process.env,
        credentialEnv: options.credentialEnv,
        timeoutMs: options.timeoutMs,
      },
      dependencies,
    );
    return {
      status: artifacts.result.status,
      durationMs: artifacts.result.run.durationMs,
      costUsd: artifacts.result.run.usage.costUsd,
      usage: artifacts.result.run.usage,
      targetSemanticMatch: artifacts.result.evaluation.targetSemanticMatch,
      allowedChangeSetMatch: artifacts.result.evaluation.allowedChangeSetMatch,
      toolStarted: artifacts.result.tooling.started,
      toolFailed: artifacts.result.tooling.failed,
    };
  } catch {
    return {
      status: "failed",
      durationMs: Math.round(performance.now() - startedAt),
      costUsd: 0,
      usage: zeroComparisonUsage(),
      targetSemanticMatch: false,
      allowedChangeSetMatch: false,
      toolStarted: 0,
      toolFailed: 1,
    };
  }
}

async function runOmpTrial(options, caseRoot, temporaryRoot, trial) {
  const loaded = await loadCodingBenchmarkCase(caseRoot);
  const trialRoot = await mkdtemp(
    path.join(temporaryRoot, `omp-trial-${trial}-`),
  );
  const workspaceRoot = path.join(trialRoot, "workspace");
  const home = path.join(trialRoot, "home");
  await Promise.all([mkdir(workspaceRoot), mkdir(home)]);
  await copyCodingBenchmarkFixture(loaded.fixtureRoot, workspaceRoot);
  const before = await createWorkspacePathSnapshot(
    workspaceRoot,
    workspaceRoot,
  );
  const processResult = await runComparisonProcess({
    command: options.ompExecutable,
    args: [
      "-p",
      "--model",
      "deepseek/deepseek-v4-flash",
      "--cwd",
      workspaceRoot,
      "--profile",
      "comparison",
      "--no-session",
      "--max-time",
      String(Math.ceil(options.timeoutMs / 1_000)),
      "--auto-approve",
      "--approval-mode",
      "yolo",
      "--mode",
      "json",
      "--no-extensions",
      "--no-skills",
      "--no-rules",
      loaded.prompt,
    ],
    cwd: workspaceRoot,
    env: {
      ...process.env,
      HOME: home,
      TMPDIR: trialRoot,
    },
    timeoutMs: options.timeoutMs,
  });
  const after = await createWorkspacePathSnapshot(workspaceRoot, workspaceRoot);
  const delta = diffWorkspaceSnapshots(before, after);
  const changedPaths = delta.entries
    .filter((entry) => entry.entryKind !== "directory")
    .map((entry) => entry.path)
    .sort();
  const allowedChangeSetMatch =
    delta.status === "changed" &&
    !delta.entriesTruncated &&
    JSON.stringify(changedPaths) ===
      JSON.stringify([...loaded.benchmarkCase.allowedChangedPaths].sort());
  const hiddenOutcomePassed =
    processResult.code === 0 &&
    allowedChangeSetMatch &&
    (await runHiddenOutcome(
      workspaceRoot,
      loaded.outcomeTestSource,
      trialRoot,
    ));
  const target = await codingBenchmarkTargetEvidence(
    path.join(workspaceRoot, loaded.benchmarkCase.targetPath),
  );
  const usage = normalizeOmpUsage(processResult.stdout);
  return {
    hiddenOutcomePassed,
    durationMs: processResult.durationMs,
    agentExitCode: processResult.code,
    targetSemanticMatch:
      target.astSha256 === loaded.benchmarkCase.expectedTargetAstSha256,
    allowedChangeSetMatch,
    ...(usage ? { usage } : {}),
  };
}

async function runHiddenOutcome(workspaceRoot, source, temporaryRoot) {
  const testPath = path.join(workspaceRoot, ".napier-comparison-outcome.mjs");
  await writeFile(testPath, source, "utf8");
  try {
    const result = await runComparisonProcess({
      command: process.execPath,
      args: [testPath],
      cwd: workspaceRoot,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: temporaryRoot,
        TMPDIR: temporaryRoot,
      },
      timeoutMs: 30_000,
    });
    return result.code === 0;
  } finally {
    await rm(testPath, { force: true });
  }
}

function createCaseReport(entry, trials, trialCount) {
  const first = trials[0];
  return {
    caseId: entry.caseId,
    complexity: entry.complexity,
    ...(entry.taskFamily ? { taskFamily: entry.taskFamily } : {}),
    caseSha256: entry.contentSha256,
    napier: {
      officialStatus: first.napier.status,
      targetSemanticMatch: first.napier.targetSemanticMatch,
      allowedChangeSetMatch: first.napier.allowedChangeSetMatch,
      outcomeTestStatus:
        first.napier.status === "passed" ? "succeeded" : "failed",
      durationMs: first.napier.durationMs,
      costUsd: first.napier.costUsd,
      usage: first.napier.usage,
      toolStarted: first.napier.toolStarted,
      toolFailed: first.napier.toolFailed,
    },
    napierOuterSandbox: {
      officialStatus: first.napier.status,
      hiddenOutcomePassed: first.napier.status === "passed",
      durationMs: first.napier.durationMs,
      costUsd: first.napier.costUsd,
      toolFailed: first.napier.toolFailed,
    },
    omp: {
      agentExitCode: first.omp.agentExitCode,
      hiddenOutcomePassed: first.omp.hiddenOutcomePassed,
      durationMs: first.omp.durationMs,
      targetSemanticMatch: first.omp.targetSemanticMatch,
      allowedChangeSetMatch: first.omp.allowedChangeSetMatch,
      ...(first.omp.usage ? { usage: first.omp.usage } : {}),
    },
    ...(trialCount > 1
      ? {
          trials: trials.map((entry) => ({
            trial: entry.trial,
            napier: {
              status: entry.napier.status,
              durationMs: entry.napier.durationMs,
              costUsd: entry.napier.costUsd,
              usage: entry.napier.usage,
            },
            omp: {
              hiddenOutcomePassed: entry.omp.hiddenOutcomePassed,
              durationMs: entry.omp.durationMs,
              ...(entry.omp.usage ? { usage: entry.omp.usage } : {}),
            },
          })),
        }
      : {}),
  };
}

function validateOptions(options) {
  if (!Number.isSafeInteger(options.seed) || options.seed < 1) {
    throw new Error("Comparison seed is invalid");
  }
  if (!["core_v1", "extended_v1"].includes(options.profile)) {
    throw new Error("Comparison profile is invalid");
  }
  if (
    !Number.isSafeInteger(options.trialCount) ||
    options.trialCount < 1 ||
    options.trialCount > 3
  ) {
    throw new Error("Comparison trial count must be 1-3");
  }
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1_000 ||
    options.timeoutMs > 120_000
  ) {
    throw new Error("Comparison timeout must be 1000-120000");
  }
  if (!process.env[options.credentialEnv]?.trim()) {
    throw new Error(
      "Comparison credential environment variable is unavailable",
    );
  }
}

async function probeOmpVersion(executable) {
  const result = await runComparisonProcess({
    command: executable,
    args: ["--version"],
    cwd: repoRoot,
    env: process.env,
    timeoutMs: 10_000,
  });
  const match = `${result.stdout}\n${result.stderr}`.match(
    /\b(?:omp[ /v]*)?([0-9]+\.[0-9]+\.[0-9]+)\b/iu,
  );
  if (result.code !== 0 || !match?.[1]) {
    throw new Error("OMP version probe failed");
  }
  return match[1];
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseArgs(argv) {
  if (argv.length % 2 !== 0) {
    throw new Error("Invalid coding executor comparison option");
  }
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      !value ||
      ![
        "--seed",
        "--profile",
        "--trials",
        "--timeout-ms",
        "--output",
        "--credential-env",
        "--omp",
        "--trusted-outer-sandbox",
      ].includes(flag)
    ) {
      throw new Error("Invalid coding executor comparison option");
    }
    if (values.has(flag)) {
      throw new Error(`Duplicate coding executor comparison option: ${flag}`);
    }
    values.set(flag, value);
  }
  return {
    seed: Number(values.get("--seed") ?? "20260806"),
    profile: values.get("--profile") ?? "extended_v1",
    trialCount: Number(values.get("--trials") ?? "1"),
    timeoutMs: Number(values.get("--timeout-ms") ?? "120000"),
    outputPath: path.resolve(
      values.get("--output") ??
        path.join(
          repoRoot,
          "benchmark-results/napier-omp-coding-comparison.json",
        ),
    ),
    credentialEnv: values.get("--credential-env") ?? "DEEPSEEK_API_KEY",
    ompExecutable: values.get("--omp") ?? "omp",
    trustedOuterSandbox: values.get("--trusted-outer-sandbox") === "true",
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const result = await runCodingExecutorComparison(options);
  process.stdout.write(
    `${JSON.stringify(
      {
        outputPath: path.relative(repoRoot, options.outputPath),
        summary: result.report.summary,
      },
      null,
      2,
    )}\n`,
  );
}
