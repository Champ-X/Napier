import { readFile } from "node:fs/promises";
import path from "node:path";

import { createLocalAgentRuntime } from "@napier/runtime";

import {
  runCodingBenchmark,
  type CodingBenchmarkArtifacts,
  type CodingBenchmarkDependencies,
  type RunCodingBenchmarkOptions,
} from "./coding-benchmark.js";
import { writeCodingBenchmarkCasFile } from "./coding-benchmark-case.js";
import {
  createCodingBenchmarkSeries,
  verifyCodingBenchmarkSeries,
} from "./coding-benchmark-series-contract.js";
import type {
  CodingBenchmarkSeries,
  CodingBenchmarkSeriesTrialArtifact,
} from "./coding-benchmark-series-types.js";

export interface RunCodingBenchmarkSeriesOptions extends RunCodingBenchmarkOptions {
  trialCount: number;
}

export interface CodingBenchmarkSeriesArtifacts {
  series: CodingBenchmarkSeries;
  seriesPath: string;
  trials: CodingBenchmarkArtifacts[];
}

const DEFAULT_DEPENDENCIES: CodingBenchmarkDependencies = {
  createRuntime: createLocalAgentRuntime,
  now: () => new Date(),
};

export async function runCodingBenchmarkSeries(
  options: RunCodingBenchmarkSeriesOptions,
  dependencies: CodingBenchmarkDependencies = DEFAULT_DEPENDENCIES,
): Promise<CodingBenchmarkSeriesArtifacts> {
  if (
    !Number.isSafeInteger(options.trialCount) ||
    options.trialCount < 2 ||
    options.trialCount > 10
  ) {
    throw new Error("Coding benchmark --trials must be 2-10");
  }
  const { trialCount, ...benchmarkOptions } = options;
  const trials: CodingBenchmarkArtifacts[] = [];
  for (let index = 0; index < trialCount; index += 1) {
    const trial = await runCodingBenchmark(benchmarkOptions, dependencies);
    trials.push(trial);
    if (options.signal?.aborted) break;
  }
  const series = createCodingBenchmarkSeries({
    generatedAt: dependencies.now().toISOString(),
    requestedTrialCount: trialCount,
    trials: trials.map((trial) => ({
      resultFileName: path.basename(trial.resultPath),
      result: trial.result,
    })),
  });
  const verificationArtifacts = await loadVerificationArtifacts(trials);
  const verification = verifyCodingBenchmarkSeries(
    series,
    verificationArtifacts,
  );
  if (!verification.valid) {
    throw new Error(
      `Coding benchmark series failed self-verification: ${verification.diagnostics.join(",")}`,
    );
  }
  const fileName = `napier-benchmark-series-${series.caseId}-${series.contentSha256.slice(0, 16)}.json`;
  const seriesPath = path.join(path.resolve(options.outputDir), fileName);
  await writeCodingBenchmarkCasFile(
    seriesPath,
    `${JSON.stringify(series, null, 2)}\n`,
  );
  return { series, seriesPath, trials };
}

async function loadVerificationArtifacts(
  trials: readonly CodingBenchmarkArtifacts[],
): Promise<CodingBenchmarkSeriesTrialArtifact[]> {
  return Promise.all(
    trials.map(async (trial) => ({
      resultFileName: path.basename(trial.resultPath),
      result: trial.result,
      bundle: JSON.parse(await readFile(trial.ledgerPath, "utf8")) as unknown,
    })),
  );
}
