import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyWorkflowBenchmarkArtifacts } from "../apps/cli/dist/workflow-benchmark-contract.js";
import {
  runWorkflowBenchmarkSeries,
  verifyWorkflowBenchmarkSeries,
  workflowBenchmarkSeriesArtifactReferences,
} from "../apps/cli/dist/workflow-benchmark-series.js";
import { runWorkflowBenchmark } from "../apps/cli/dist/workflow-benchmark.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_LEDGER_BYTES = 256 * 1024;
const MAX_SERIES_BYTES = 256 * 1024;
const args = parseArgs(process.argv.slice(2));

if (args.verifySeries) {
  const series = await readJson(args.verifySeries, MAX_SERIES_BYTES);
  const artifactRoot = path.dirname(args.verifySeries);
  const artifacts = [];
  for (const reference of workflowBenchmarkSeriesArtifactReferences(series)) {
    artifacts.push({
      resultFileName: reference.resultFileName,
      result: await readJson(
        path.join(artifactRoot, reference.resultFileName),
        MAX_RESULT_BYTES,
      ),
      bundle: await readJson(
        path.join(artifactRoot, reference.ledgerFileName),
        MAX_LEDGER_BYTES,
      ),
    });
  }
  const verification = verifyWorkflowBenchmarkSeries(series, artifacts);
  process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
  if (!verification.valid) process.exitCode = 1;
} else if (args.verifyResult) {
  const [result, bundle] = await Promise.all([
    readJson(args.verifyResult, MAX_RESULT_BYTES),
    readJson(args.ledger, MAX_LEDGER_BYTES),
  ]);
  const verification = verifyWorkflowBenchmarkArtifacts(result, bundle);
  process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
  if (!verification.valid) process.exitCode = 1;
} else {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const options = {
      caseRoot:
        args.caseRoot ??
        path.join(repoRoot, "benchmarks/workflow/document-map-reduce-v1"),
      outputDir: args.outputDir ?? path.join(repoRoot, "benchmark-results"),
      model: args.model ?? { provider: "napier", id: "demo" },
      env: process.env,
      ...(args.credentialEnv ? { credentialEnv: args.credentialEnv } : {}),
      ...(args.timeoutMs ? { timeoutMs: args.timeoutMs } : {}),
      signal: controller.signal,
    };
    if ((args.trialCount ?? 1) > 1) {
      const artifacts = await runWorkflowBenchmarkSeries({
        ...options,
        trialCount: args.trialCount,
      });
      process.stdout.write(
        `${JSON.stringify(
          {
            status: artifacts.series.status,
            caseId: artifacts.series.caseId,
            model: artifacts.series.model,
            requestedTrialCount: artifacts.series.requestedTrialCount,
            completedTrialCount: artifacts.series.completedTrialCount,
            scoredTrialCount: artifacts.series.scoredTrialCount,
            passedTrialCount: artifacts.series.passedTrialCount,
            failedTrialCount: artifacts.series.failedTrialCount,
            inconclusiveTrialCount: artifacts.series.inconclusiveTrialCount,
            usageSampleCount: artifacts.series.usageSampleCount,
            successRate: artifacts.series.successRate,
            passRate: artifacts.series.passRate,
            metrics: artifacts.series.metrics,
            seriesSha256: artifacts.series.contentSha256,
            seriesPath: path.relative(repoRoot, artifacts.seriesPath),
          },
          null,
          2,
        )}\n`,
      );
      if (
        artifacts.series.status !== "completed" ||
        artifacts.series.failedTrialCount > 0 ||
        artifacts.series.inconclusiveTrialCount > 0
      ) {
        process.exitCode = 1;
      }
    } else {
      const artifacts = await runWorkflowBenchmark(options);
      process.stdout.write(
        `${JSON.stringify(
          {
            status: artifacts.result.status,
            caseId: artifacts.result.caseId,
            model: artifacts.result.model,
            durationMs: artifacts.result.run.durationMs,
            runCount: artifacts.result.run.runCount,
            usage: artifacts.result.run.usage,
            evaluation: artifacts.result.evaluation,
            resultSha256: artifacts.result.contentSha256,
            resultPath: path.relative(repoRoot, artifacts.resultPath),
            ledgerPath: path.relative(repoRoot, artifacts.ledgerPath),
          },
          null,
          2,
        )}\n`,
      );
      if (artifacts.result.status !== "passed") process.exitCode = 1;
    }
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

function parseArgs(argv) {
  const values = new Map();
  const allowed = new Set([
    "--case",
    "--output-dir",
    "--model",
    "--credential-env",
    "--timeout-ms",
    "--trials",
    "--verify-result",
    "--ledger",
    "--verify-series",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag)) {
      throw new Error("Unknown Workflow benchmark option");
    }
    if (values.has(flag)) {
      throw new Error(`Duplicate Workflow benchmark option: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    values.set(flag, value);
    index += 1;
  }
  const verifyResult = values.get("--verify-result");
  const ledger = values.get("--ledger");
  const verifySeries = values.get("--verify-series");
  if (Boolean(verifyResult) !== Boolean(ledger)) {
    throw new Error("--verify-result and --ledger must be used together");
  }
  if (verifySeries && values.size !== 1) {
    throw new Error("--verify-series cannot be combined with other options");
  }
  if (
    verifyResult &&
    [...values.keys()].some(
      (flag) => flag !== "--verify-result" && flag !== "--ledger",
    )
  ) {
    throw new Error("Verification cannot be combined with execution options");
  }
  return {
    ...(values.has("--case")
      ? { caseRoot: path.resolve(values.get("--case")) }
      : {}),
    ...(values.has("--output-dir")
      ? { outputDir: path.resolve(values.get("--output-dir")) }
      : {}),
    ...(values.has("--model")
      ? { model: parseModel(values.get("--model")) }
      : {}),
    ...(values.has("--credential-env")
      ? { credentialEnv: values.get("--credential-env") }
      : {}),
    ...(values.has("--timeout-ms")
      ? { timeoutMs: parsePositiveInteger(values.get("--timeout-ms")) }
      : {}),
    ...(values.has("--trials")
      ? { trialCount: parseTrialCount(values.get("--trials")) }
      : {}),
    ...(verifyResult
      ? {
          verifyResult: path.resolve(verifyResult),
          ledger: path.resolve(ledger),
        }
      : {}),
    ...(verifySeries ? { verifySeries: path.resolve(verifySeries) } : {}),
  };
}

function parseModel(value) {
  const separator = value.indexOf("/");
  const provider = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (
    separator < 1 ||
    !/^[a-z][a-z0-9_-]{0,63}$/u.test(provider) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(id)
  ) {
    throw new Error("--model must be provider/model-id");
  }
  return { provider, id };
}

function parsePositiveInteger(value) {
  if (!/^[0-9]+$/u.test(value)) {
    throw new Error("--timeout-ms must be a positive integer");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000) {
    throw new Error("--timeout-ms must be a positive integer");
  }
  return parsed;
}

function parseTrialCount(value) {
  if (!/^[0-9]+$/u.test(value)) {
    throw new Error("--trials must be 2-10");
  }
  const parsed = Number(value);
  if (parsed < 2 || parsed > 10) {
    throw new Error("--trials must be 2-10");
  }
  return parsed;
}

async function readJson(filePath, maximumBytes) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximumBytes) {
    throw new Error("Workflow benchmark artifact is unsafe");
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}
