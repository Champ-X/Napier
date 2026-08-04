import path from "node:path";
import { fileURLToPath } from "node:url";

import { runGoalNoProgressBenchmarkSeries } from "../apps/cli/dist/goal-no-progress-benchmark-series.js";
import { runGoalNoProgressBenchmark } from "../apps/cli/dist/goal-no-progress-benchmark.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = parseArgs(process.argv.slice(2));
const controller = new AbortController();
const abort = () => controller.abort();
process.once("SIGINT", abort);
process.once("SIGTERM", abort);

try {
  const options = {
    caseRoot:
      args.caseRoot ??
      path.join(repoRoot, "benchmarks/long-horizon/goal-no-progress-v1"),
    outputDir: args.outputDir ?? path.join(repoRoot, "benchmark-results"),
    model: args.model ?? { provider: "napier", id: "demo" },
    env: process.env,
    ...(args.credentialEnv ? { credentialEnv: args.credentialEnv } : {}),
    signal: controller.signal,
  };
  if ((args.trialCount ?? 1) > 1) {
    const artifacts = await runGoalNoProgressBenchmarkSeries({
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
          passedTrialCount: artifacts.series.passedTrialCount,
          failedTrialCount: artifacts.series.failedTrialCount,
          inconclusiveTrialCount: artifacts.series.inconclusiveTrialCount,
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
    const artifacts = await runGoalNoProgressBenchmark(options);
    process.stdout.write(
      `${JSON.stringify(
        {
          status: artifacts.result.status,
          caseId: artifacts.result.caseId,
          model: artifacts.result.model,
          run: artifacts.result.run,
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

function parseArgs(argv) {
  const values = new Map();
  const allowed = new Set([
    "--case",
    "--output-dir",
    "--model",
    "--credential-env",
    "--trials",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || !value || value.startsWith("--")) {
      throw new Error("Invalid Goal no-progress benchmark option");
    }
    if (values.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    values.set(flag, value);
    index += 1;
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
    ...(values.has("--trials")
      ? { trialCount: parseTrialCount(values.get("--trials")) }
      : {}),
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

function parseTrialCount(value) {
  const parsed = Number(value);
  if (!/^[0-9]+$/u.test(value) || parsed < 2 || parsed > 10) {
    throw new Error("--trials must be 2-10");
  }
  return parsed;
}
