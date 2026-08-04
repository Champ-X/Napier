#!/usr/bin/env node

import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadOpenWebResearchBenchmarkCase } from "../apps/cli/dist/open-web-research-benchmark-case.js";
import { runOpenWebResearchBenchmark } from "../apps/cli/dist/open-web-research-benchmark.js";
import {
  verifyOpenWebResearchBenchmarkAgainstCase,
  verifyOpenWebResearchBenchmarkResult,
} from "../apps/cli/dist/open-web-research-benchmark-verifier.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = parseArgs(process.argv.slice(2));

if (args.verifyResult) {
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
    const artifacts = await runOpenWebResearchBenchmark({
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
    });
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
    "--verify-result",
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
    ...(verifyResult ? { verifyResult: path.resolve(verifyResult) } : {}),
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
