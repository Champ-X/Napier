import path from "node:path";
import { fileURLToPath } from "node:url";

import { createTrustedOuterProcessBenchmarkSandbox } from "../apps/cli/dist/process-recovery-benchmark-sandbox.js";
import { runProcessRecoveryBenchmarkSeries } from "../apps/cli/dist/process-recovery-benchmark-series.js";
import { runProcessRecoveryBenchmark } from "../apps/cli/dist/process-recovery-benchmark.js";

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
      path.join(
        repoRoot,
        "benchmarks/long-horizon/process-write-compensation-v1",
      ),
    outputDir: args.outputDir ?? path.join(repoRoot, "benchmark-results"),
    signal: controller.signal,
  };
  const dependencies = args.trustedOuterSandbox
    ? {
        createSandbox: createTrustedOuterProcessBenchmarkSandbox,
        now: () => new Date(),
      }
    : undefined;
  if ((args.trialCount ?? 1) > 1) {
    const artifacts = await runProcessRecoveryBenchmarkSeries(
      { ...options, trialCount: args.trialCount },
      dependencies,
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          status: artifacts.series.status,
          caseId: artifacts.series.caseId,
          executor: artifacts.series.executor,
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
    const artifacts = await runProcessRecoveryBenchmark(options, dependencies);
    process.stdout.write(
      `${JSON.stringify(
        {
          status: artifacts.result.status,
          caseId: artifacts.result.caseId,
          executor: artifacts.result.executor,
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
  let trustedOuterSandbox = false;
  const valued = new Set(["--case", "--output-dir", "--trials"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--trusted-outer-sandbox") {
      if (trustedOuterSandbox) throw new Error(`Duplicate option: ${flag}`);
      trustedOuterSandbox = true;
      continue;
    }
    const value = argv[index + 1];
    if (!valued.has(flag) || !value || value.startsWith("--")) {
      throw new Error("Invalid Process recovery benchmark option");
    }
    if (values.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    values.set(flag, value);
    index += 1;
  }
  return {
    trustedOuterSandbox,
    ...(values.has("--case")
      ? { caseRoot: path.resolve(values.get("--case")) }
      : {}),
    ...(values.has("--output-dir")
      ? { outputDir: path.resolve(values.get("--output-dir")) }
      : {}),
    ...(values.has("--trials")
      ? { trialCount: parseTrialCount(values.get("--trials")) }
      : {}),
  };
}

function parseTrialCount(value) {
  const parsed = Number(value);
  if (!/^[0-9]+$/u.test(value) || parsed < 2 || parsed > 20) {
    throw new Error("--trials must be 2-20");
  }
  return parsed;
}
