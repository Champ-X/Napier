#!/usr/bin/env node

import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadOpenWebResearchBenchmarkCase } from "../packages/benchmark-kit/dist/open-web-research-benchmark-case.js";
import { runOpenWebResearchBenchmark } from "../packages/benchmark-kit/dist/open-web-research-benchmark.js";
import {
  openWebResearchSeriesArtifactReferences,
  runOpenWebResearchSeries,
  verifyOpenWebResearchSeries,
} from "../packages/benchmark-kit/dist/open-web-research-series.js";
import {
  openWebResearchSecuritySeriesArtifactReferences,
  runOpenWebResearchSecuritySeries,
  verifyOpenWebResearchSecuritySeries,
} from "../packages/benchmark-kit/dist/open-web-research-security-series.js";
import {
  verifyOpenWebResearchBenchmarkAgainstCase,
  verifyOpenWebResearchBenchmarkResult,
} from "../packages/benchmark-kit/dist/open-web-research-benchmark-verifier.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = parseArgs(process.argv.slice(2));

if (args.verifySeries) {
  const series = await readJson(args.verifySeries, 512 * 1024);
  const root = path.dirname(args.verifySeries);
  const loaded = await loadOpenWebResearchBenchmarkCase(args.caseRoot);
  const seriesContract = selectSeriesContract(loaded.benchmarkCase);
  const artifacts = [];
  for (const reference of seriesContract.artifactReferences(series)) {
    artifacts.push({
      resultFileName: reference.resultFileName,
      result: await readJson(
        path.join(root, reference.resultFileName),
        2 * 1024 * 1024,
      ),
    });
  }
  const verification = seriesContract.verify(
    series,
    artifacts,
    loaded.benchmarkCase,
    loaded.expected,
  );
  console.log(JSON.stringify(verification, null, 2));
  if (!verification.valid) process.exitCode = 1;
} else if (args.verifyResult) {
  const result = await readJson(args.verifyResult, 2 * 1024 * 1024);
  const verification = args.caseRoot
    ? await verifyAgainstCase(result, args.caseRoot)
    : verifyOpenWebResearchBenchmarkResult(result);
  console.log(JSON.stringify(verification, null, 2));
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
        path.join(repoRoot, "benchmarks/research/open-web-source-triad-v1"),
      outputDir: args.outputDir ?? path.join(repoRoot, "benchmark-results"),
      model: args.model ?? {
        provider: "deepseek",
        id: "deepseek-v4-flash",
      },
      env: process.env,
      ...(args.credentialEnv ? { credentialEnv: args.credentialEnv } : {}),
      ...(args.timeoutMs ? { timeoutMs: args.timeoutMs } : {}),
      signal: controller.signal,
    };
    if ((args.trialCount ?? 1) > 1) {
      const loaded = await loadOpenWebResearchBenchmarkCase(options.caseRoot);
      const artifacts = await selectSeriesContract(loaded.benchmarkCase).run({
        ...options,
        trialCount: args.trialCount,
      });
      const capabilitySummary =
        artifacts.series.kind === "napier.open-web-research-series"
          ? {
              claimsMatchTrialCount: artifacts.series.claimsMatchTrialCount,
              toolTopologyMatchTrialCount:
                artifacts.series.toolTopologyMatchTrialCount,
              sourceCoverageMatchTrialCount:
                artifacts.series.sourceCoverageMatchTrialCount,
              citationEvidenceMatchTrialCount:
                artifacts.series.citationEvidenceMatchTrialCount,
              citationClaimsMatchTrialCount:
                artifacts.series.citationClaimsMatchTrialCount,
              replayValidTrialCount: artifacts.series.replayValidTrialCount,
              credentialLeakTrialCount:
                artifacts.series.credentialLeakTrialCount,
            }
          : {
              promptInjectionLeakTrialCount:
                artifacts.series.promptInjectionLeakTrialCount,
              forbiddenToolAttemptTrialCount:
                artifacts.series.forbiddenToolAttemptTrialCount,
              exactFinalResponseRate: artifacts.series.exactFinalResponseRate,
              replayValidTrialCount: artifacts.series.replayValidTrialCount,
              credentialLeakTrialCount:
                artifacts.series.credentialLeakTrialCount,
            };
      console.log(
        JSON.stringify(
          {
            status: artifacts.series.status,
            caseId: artifacts.series.caseId,
            model: artifacts.series.model,
            completedTrialCount: artifacts.series.completedTrialCount,
            passedTrialCount: artifacts.series.passedTrialCount,
            failedTrialCount: artifacts.series.failedTrialCount,
            inconclusiveTrialCount: artifacts.series.inconclusiveTrialCount,
            ...capabilitySummary,
            passRate: artifacts.series.passRate,
            metrics: artifacts.series.metrics,
            seriesSha256: artifacts.series.contentSha256,
            seriesPath: path.relative(repoRoot, artifacts.seriesPath),
          },
          null,
          2,
        ),
      );
      if (
        artifacts.series.status !== "completed" ||
        artifacts.series.failedTrialCount > 0 ||
        artifacts.series.inconclusiveTrialCount > 0
      ) {
        process.exitCode = 1;
      }
    } else {
      const artifacts = await runOpenWebResearchBenchmark(options);
      console.log(
        JSON.stringify(
          {
            status: artifacts.result.status,
            caseId: artifacts.result.caseId,
            model: artifacts.result.model,
            durationMs: artifacts.result.run.durationMs,
            usage: artifacts.result.run.usage,
            searchCount: artifacts.result.searchCount,
            fetchCount: artifacts.result.fetchCount,
            browserCount: artifacts.result.browserCount,
            citationCount: artifacts.result.citationCount,
            citationSourceKindCount: artifacts.result.citationSourceKindCount,
            diagnostics: artifacts.result.diagnostics,
            resultSha256: artifacts.result.contentSha256,
            resultPath: path.relative(repoRoot, artifacts.resultPath),
          },
          null,
          2,
        ),
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
    "--verify-series",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag))
      throw new Error("Unknown open-web benchmark option");
    if (values.has(flag)) {
      throw new Error(`Duplicate open-web benchmark option: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    values.set(flag, value);
    index += 1;
  }
  const verifyResult = values.get("--verify-result");
  const verifySeries = values.get("--verify-series");
  if (verifySeries && !values.has("--case")) {
    throw new Error("--verify-series requires --case");
  }
  if (
    verifySeries &&
    [...values.keys()].some(
      (key) => key !== "--verify-series" && key !== "--case",
    )
  ) {
    throw new Error("--verify-series can only be combined with --case");
  }
  if (
    verifyResult &&
    [...values.keys()].some(
      (key) => key !== "--verify-result" && key !== "--case",
    )
  ) {
    throw new Error("--verify-result can only be combined with --case");
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
    ...(verifyResult ? { verifyResult: path.resolve(verifyResult) } : {}),
    ...(verifySeries ? { verifySeries: path.resolve(verifySeries) } : {}),
  };
}

function parseModel(value) {
  const separator = value.indexOf("/");
  const provider = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!provider || !id) throw new Error("--model must be provider/model-id");
  return { provider, id };
}

function parsePositiveInteger(value) {
  if (!/^[0-9]+$/u.test(value)) throw new Error("timeout must be an integer");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("timeout must be positive");
  }
  return parsed;
}

function parseTrialCount(value) {
  const trialCount = parsePositiveInteger(value);
  if (trialCount < 2 || trialCount > 10) {
    throw new Error("--trials must be 2-10");
  }
  return trialCount;
}

async function readJson(filePath, maximumBytes) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximumBytes) {
    throw new Error("Open-web benchmark result file is invalid");
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function verifyAgainstCase(result, caseRoot) {
  const loaded = await loadOpenWebResearchBenchmarkCase(caseRoot);
  return verifyOpenWebResearchBenchmarkAgainstCase(
    result,
    loaded.benchmarkCase,
    loaded.expected,
  );
}

function selectSeriesContract(benchmarkCase) {
  if (benchmarkCase.schemaVersion === 1) {
    return {
      artifactReferences: openWebResearchSeriesArtifactReferences,
      run: runOpenWebResearchSeries,
      verify: verifyOpenWebResearchSeries,
    };
  }
  return {
    artifactReferences: openWebResearchSecuritySeriesArtifactReferences,
    run: runOpenWebResearchSecuritySeries,
    verify: verifyOpenWebResearchSecuritySeries,
  };
}
