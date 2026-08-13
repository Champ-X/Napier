#!/usr/bin/env node

import { homedir, tmpdir } from "node:os";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import { BrowserUseLocalBackend } from "../packages/runtime/dist/browser-use-local-backend.js";
import {
  BROWSER_USE_LOCAL_VERSION,
  inspectBrowserUseLocalRuntime,
  installBrowserUseLocalRuntime,
} from "../packages/runtime/dist/browser-use-local-setup.js";

import {
  createBrowserAutonomyComparison,
  summarizeBrowserAutonomyTrials,
  verifyBrowserAutonomyComparison,
} from "./browser-autonomy-comparison.mjs";
import { evaluateOpenWebComparisonOutcome } from "./open-web-comparison-oracle.mjs";
import { scanOpenWebComparisonSecrets } from "./open-web-comparison-secret-scan.mjs";
import { createOpenWebComparisonSuite } from "./open-web-comparison-suite.mjs";
import {
  removeOpenWebComparisonTemporaryRoot,
  runOpenWebComparisonTrial,
} from "./open-web-comparison-trial.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const args = parseArgs(process.argv.slice(2));

if (args.verify) {
  const report = await readJson(args.verify, 512 * 1024);
  const verification = verifyBrowserAutonomyComparison(report);
  print(verification);
  if (!verification.valid) process.exitCode = 1;
} else {
  const secret = process.env[args.credentialEnv]?.trim();
  if (!secret)
    throw new Error(
      "Browser autonomy comparison credential environment variable is unavailable",
    );
  const dataRoot = args.dataRoot ?? path.join(homedir(), ".napier");
  const signal = AbortSignal.timeout(
    args.timeoutMs * args.trialCount * 2 + 120_000,
  );
  let inspection = await inspectBrowserUseLocalRuntime(dataRoot);
  if (inspection.status !== "ready" && args.setup) {
    inspection = await installBrowserUseLocalRuntime({
      dataRoot,
      env: process.env,
      signal,
    });
  }
  if (inspection.status !== "ready") {
    throw new Error(
      "Browser Use local runtime is not ready; rerun with --setup after installing uv and Chrome",
    );
  }
  const suite = createOpenWebComparisonSuite(args.seed);
  const benchmarkCase = suite.cases.find(
    (item) => item.taskFamily === "dynamic_browser_evidence",
  );
  if (!benchmarkCase)
    throw new Error("Dynamic Browser comparison Case is unavailable");
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "napier-browser-autonomy-"),
  );
  const napierEntry = await realpath(
    path.join(repoRoot, "apps/cli/dist/index.js"),
  );
  const trials = [];
  try {
    for (let trial = 1; trial <= args.trialCount; trial += 1) {
      const order =
        trial % 2 === 1
          ? ["napier", "browser_use_local"]
          : ["browser_use_local", "napier"];
      const outcomes = {};
      for (const executor of order) {
        outcomes[executor] =
          executor === "napier"
            ? normalizeNapierOutcome(
                await runOpenWebComparisonTrial({
                  executor: "napier",
                  track: "controlled",
                  trial,
                  benchmarkCase,
                  temporaryRoot,
                  timeoutMs: args.timeoutMs,
                  credentialEnv: args.credentialEnv,
                  env: process.env,
                  secret,
                  napierEntry,
                  signal,
                }),
              )
            : await runBrowserUseOutcome({
                benchmarkCase,
                dataRoot,
                secret,
                timeoutMs: args.timeoutMs,
                signal,
              });
      }
      trials.push({
        trial,
        order,
        napier: outcomes.napier,
        browserUse: outcomes.browser_use_local,
      });
    }
    const content = {
      type: "napier.browser-autonomy-comparison",
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      seed: args.seed,
      trialCount: args.trialCount,
      timeoutMs: args.timeoutMs,
      model: { provider: "deepseek", id: "deepseek-v4-flash" },
      case: {
        caseId: benchmarkCase.id,
        taskFamily: benchmarkCase.taskFamily,
        promptSha256: benchmarkCase.promptSha256,
        oracleSha256: benchmarkCase.oracleSha256,
        caseSha256: benchmarkCase.caseSha256,
      },
      fairness: {
        sameModel: true,
        samePrompt: true,
        freshProfilePerTrial: true,
        isolatedStatePerExecutor: true,
        sameReadOnlyPolicy: true,
        alternatingOrder: true,
      },
      environment: {
        platform: process.platform,
        architecture: process.arch,
        nodeVersion: process.versions.node,
        napierVersion: "0.1.0",
        browserUseVersion: BROWSER_USE_LOCAL_VERSION,
        browserProduct: inspection.browserProduct,
        browserVersion: inspection.browserVersion,
      },
      trials,
      summary: undefined,
      notes: [
        "This is a narrow dynamic-page baseline, not a general superiority claim.",
        "Raw prompts, URLs, page text, model output, screenshots, reasoning, and credentials are not retained.",
      ],
    };
    content.summary = summarizeBrowserAutonomyTrials(trials);
    const report = createBrowserAutonomyComparison(content);
    await mkdir(args.outputDir, { recursive: true, mode: 0o700 });
    const reportPath = path.join(
      args.outputDir,
      `napier-browser-autonomy-comparison-seed-${String(args.seed)}-${report.contentSha256.slice(0, 16)}.json`,
    );
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    print({
      status: report.summary.verdict,
      reportPath: path.relative(repoRoot, reportPath),
      reportSha256: report.contentSha256,
      summary: report.summary,
    });
    if (report.summary.verdict !== "napier_not_worse") process.exitCode = 1;
  } finally {
    await removeOpenWebComparisonTemporaryRoot(temporaryRoot);
  }
}

async function runBrowserUseOutcome({
  benchmarkCase,
  dataRoot,
  secret,
  timeoutMs,
  signal,
}) {
  const startedAt = Date.now();
  let artifactDirectory;
  let finalText = "";
  const observations = [];
  try {
    const backend = new BrowserUseLocalBackend({
      dataRoot,
      env: { ...process.env, NAPIER_BROWSER_USE_CREDENTIAL: secret },
    });
    const result = await backend.run(
      {
        task: benchmarkCase.prompt,
        startUrl: "https://quotes.toscrape.com/js/",
        model: { provider: "deepseek", id: "deepseek-v4-flash" },
        allowedDomains: ["quotes.toscrape.com"],
        maxSteps: 20,
      },
      (observation) => observations.push(observation),
      signal,
    );
    artifactDirectory = result.artifactDirectory;
    finalText = result.result;
    const oracle = evaluateOpenWebComparisonOutcome({
      benchmarkCase,
      finalText,
      toolCounts: { search: 0, fetch: 0, browser: 1 },
    });
    const scan = await scanOpenWebComparisonSecrets(
      [artifactDirectory],
      [secret],
    );
    const failedSteps = observations.filter(
      (item) => item.type === "step" && item.errorCode,
    ).length;
    const status = scan.leakDetected
      ? "failed"
      : result.status === "completed"
        ? oracle.passed
          ? "passed"
          : "failed"
        : result.status === "cancelled"
          ? "inconclusive"
          : "failed";
    return outcome({
      executor: "browser_use_local",
      status,
      durationMs: Date.now() - startedAt,
      stepCount: result.stepCount,
      toolFailureCount: failedSteps,
      secretLeakDetected: scan.leakDetected,
      finalText,
      diagnostics: [
        ...oracle.diagnostics,
        ...(result.status === "completed" ? [] : [`backend_${result.status}`]),
      ],
      costUsd: result.costUsd ?? null,
      totalTokens: result.totalTokens ?? null,
    });
  } catch (error) {
    return outcome({
      executor: "browser_use_local",
      status: signal.aborted ? "inconclusive" : "infrastructure_failure",
      durationMs: Date.now() - startedAt,
      stepCount: observations.filter((item) => item.type === "step").length,
      toolFailureCount: 1,
      secretLeakDetected: false,
      finalText,
      diagnostics: [
        `backend_error_${sha256(error instanceof Error ? error.message : String(error)).slice(0, 16)}`,
      ],
      costUsd: null,
      totalTokens: null,
    });
  } finally {
    if (artifactDirectory)
      await rm(artifactDirectory, { recursive: true, force: true });
  }
}

function normalizeNapierOutcome(input) {
  return outcome({
    executor: "napier",
    status: input.status,
    durationMs: input.durationMs,
    stepCount: input.toolCounts.browser,
    toolFailureCount: input.toolFailed,
    secretLeakDetected: input.security.secretLeakDetected,
    finalText: input.evidence.finalOutputSha256,
    finalOutputIsDigest: true,
    diagnostics: input.diagnostics,
    costUsd: input.usage.costUsd ?? null,
    totalTokens: input.usage.inputTokens + input.usage.outputTokens,
  });
}

function outcome(input) {
  return {
    executor: input.executor,
    status: input.status,
    outcomePassed: input.status === "passed",
    durationMs: input.durationMs,
    stepCount: input.stepCount,
    toolFailureCount: input.toolFailureCount,
    secretLeakDetected: input.secretLeakDetected,
    freshProfile: true,
    finalOutputSha256: input.finalOutputIsDigest
      ? input.finalText
      : sha256(input.finalText),
    diagnosticSetSha256: sha256(
      canonicalJson([...new Set(input.diagnostics)].sort()),
    ),
    costUsd: input.costUsd,
    totalTokens: input.totalTokens,
  };
}

function parseArgs(argv) {
  const options = {
    seed: 20260813,
    trialCount: 3,
    timeoutMs: 180_000,
    credentialEnv: "DEEPSEEK_API_KEY",
    outputDir: path.join(repoRoot, "benchmark-results"),
    setup: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--setup") {
      options.setup = true;
      continue;
    }
    const value = argv[++index];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--seed")
      options.seed = boundedInteger(value, 1, 99999999, flag);
    else if (flag === "--trials")
      options.trialCount = boundedInteger(value, 1, 10, flag);
    else if (flag === "--timeout-ms")
      options.timeoutMs = boundedInteger(value, 10_000, 300_000, flag);
    else if (flag === "--credential-env") options.credentialEnv = value;
    else if (flag === "--data-root") options.dataRoot = path.resolve(value);
    else if (flag === "--output-dir") options.outputDir = path.resolve(value);
    else if (flag === "--verify") options.verify = path.resolve(value);
    else throw new Error(`Unknown Browser autonomy comparison option: ${flag}`);
  }
  if (options.verify && argv.length !== 2)
    throw new Error("--verify cannot be combined with execution options");
  return options;
}

function boundedInteger(value, minimum, maximum, flag) {
  const number = Number(value);
  if (!/^[0-9]+$/u.test(value) || number < minimum || number > maximum)
    throw new Error(`${flag} is out of range`);
  return number;
}

async function readJson(filePath, maximumBytes) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximumBytes)
    throw new Error("Browser autonomy comparison artifact is unsafe");
  return JSON.parse(await readFile(filePath, "utf8"));
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
