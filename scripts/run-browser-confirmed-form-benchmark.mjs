#!/usr/bin/env node

import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyBrowserConfirmedFormBenchmarkArtifacts } from "../apps/cli/dist/browser-confirmed-form-benchmark-contract.js";
import {
  browserConfirmedFormSeriesArtifactReferences,
  runBrowserConfirmedFormBenchmarkSeries,
  verifyBrowserConfirmedFormBenchmarkSeries,
} from "../apps/cli/dist/browser-confirmed-form-benchmark-series.js";
import { runBrowserConfirmedFormBenchmark } from "../apps/cli/dist/browser-confirmed-form-benchmark.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_LEDGER_BYTES = 4 * 1024 * 1024;
const MAX_SERIES_BYTES = 256 * 1024;
const DEFAULT_TARGET_URL =
  "https://www.selenium.dev/selenium/web/formPage.html";
const DEFAULT_FORM_VALUE = "napier-form-benchmark@example.com";
const args = parseArgs(process.argv.slice(2));

if (args.verifySeries) {
  const series = await readJson(args.verifySeries, MAX_SERIES_BYTES);
  const artifactRoot = path.dirname(args.verifySeries);
  const artifacts = [];
  for (const reference of browserConfirmedFormSeriesArtifactReferences(
    series,
  )) {
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
  const verification = verifyBrowserConfirmedFormBenchmarkSeries(
    series,
    artifacts,
  );
  print(verification);
  if (!verification.valid) process.exitCode = 1;
} else if (args.verifyResult) {
  const [result, bundle] = await Promise.all([
    readJson(args.verifyResult, MAX_RESULT_BYTES),
    readJson(args.ledger, MAX_LEDGER_BYTES),
  ]);
  const verification = verifyBrowserConfirmedFormBenchmarkArtifacts(
    result,
    bundle,
  );
  print(verification);
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
        path.join(repoRoot, "benchmarks/browser/confirmed-form-cli-v1"),
      outputDir: args.outputDir ?? path.join(repoRoot, "benchmark-results"),
      model: args.model ?? {
        provider: "deepseek",
        id: "deepseek-v4-flash",
      },
      env: process.env,
      credentialEnv: args.credentialEnv ?? "DEEPSEEK_API_KEY",
      targetUrl: args.targetUrl ?? DEFAULT_TARGET_URL,
      formValue: args.formValue ?? DEFAULT_FORM_VALUE,
      signal: controller.signal,
    };
    if ((args.trialCount ?? 1) > 1) {
      const artifacts = await runBrowserConfirmedFormBenchmarkSeries({
        ...options,
        trialCount: args.trialCount,
      });
      print({
        status: artifacts.series.status,
        caseId: artifacts.series.caseId,
        model: artifacts.series.model,
        requestedTrialCount: artifacts.series.requestedTrialCount,
        completedTrialCount: artifacts.series.completedTrialCount,
        passedTrialCount: artifacts.series.passedTrialCount,
        failedTrialCount: artifacts.series.failedTrialCount,
        inconclusiveTrialCount: artifacts.series.inconclusiveTrialCount,
        completionRate: artifacts.series.completionRate,
        passRate: artifacts.series.passRate,
        metrics: artifacts.series.metrics,
        seriesSha256: artifacts.series.contentSha256,
        seriesPath: path.relative(repoRoot, artifacts.seriesPath),
      });
      if (
        artifacts.series.status !== "completed" ||
        artifacts.series.failedTrialCount > 0 ||
        artifacts.series.inconclusiveTrialCount > 0
      ) {
        process.exitCode = 1;
      }
    } else {
      const artifacts = await runBrowserConfirmedFormBenchmark(options);
      print({
        status: artifacts.result.status,
        caseId: artifacts.result.caseId,
        model: artifacts.result.model,
        run: artifacts.result.run,
        execution: artifacts.result.execution,
        evaluation: artifacts.result.evaluation,
        resultSha256: artifacts.result.contentSha256,
        resultPath: path.relative(repoRoot, artifacts.resultPath),
        ledgerPath: path.relative(repoRoot, artifacts.ledgerPath),
      });
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
    "--target-url",
    "--form-value",
    "--trials",
    "--verify-result",
    "--ledger",
    "--verify-series",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag)) {
      throw new Error("Unknown Browser confirmed form benchmark option");
    }
    if (values.has(flag)) throw new Error(`Duplicate option: ${flag}`);
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
    ...(values.has("--target-url")
      ? { targetUrl: values.get("--target-url") }
      : {}),
    ...(values.has("--form-value")
      ? { formValue: values.get("--form-value") }
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

function parseTrialCount(value) {
  const parsed = Number(value);
  if (!/^[0-9]+$/u.test(value) || parsed < 2 || parsed > 10) {
    throw new Error("--trials must be 2-10");
  }
  return parsed;
}

async function readJson(filePath, maximumBytes) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximumBytes) {
    throw new Error("Browser confirmed form benchmark artifact is unsafe");
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
