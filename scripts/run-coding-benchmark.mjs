import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCodingBenchmark } from "../apps/cli/dist/coding-benchmark.js";
import { verifyCodingBenchmarkArtifacts } from "../apps/cli/dist/coding-benchmark-contract.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_LEDGER_BYTES = 4 * 1024 * 1024;
const args = parseArgs(process.argv.slice(2));

if (args.verifyResult) {
  const [result, ledger] = await Promise.all([
    readJson(args.verifyResult, MAX_RESULT_BYTES),
    readJson(args.ledger, MAX_LEDGER_BYTES),
  ]);
  const verification = verifyCodingBenchmarkArtifacts(result, ledger);
  process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
  if (!verification.valid) process.exitCode = 1;
} else {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const artifacts = await runCodingBenchmark({
      caseRoot:
        args.caseRoot ??
        path.join(repoRoot, "benchmarks/coding/shipping-boundary-v1"),
      outputDir: args.outputDir ?? path.join(repoRoot, "benchmark-results"),
      model: args.model ?? { provider: "napier", id: "demo" },
      env: process.env,
      ...(args.credentialEnv ? { credentialEnv: args.credentialEnv } : {}),
      ...(args.timeoutMs ? { timeoutMs: args.timeoutMs } : {}),
      signal: controller.signal,
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          status: artifacts.result.status,
          caseId: artifacts.result.caseId,
          model: artifacts.result.model,
          durationMs: artifacts.result.run.durationMs,
          usage: artifacts.result.run.usage,
          resultSha256: artifacts.result.contentSha256,
          resultPath: path.relative(repoRoot, artifacts.resultPath),
          ledgerPath: path.relative(repoRoot, artifacts.ledgerPath),
        },
        null,
        2,
      )}\n`,
    );
    if (artifacts.result.status !== "passed") process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (
      ![
        "--case",
        "--output-dir",
        "--model",
        "--credential-env",
        "--timeout-ms",
        "--verify-result",
        "--ledger",
      ].includes(flag)
    ) {
      throw new Error("Unknown coding benchmark option");
    }
    if (values.has(flag)) {
      throw new Error(`Duplicate coding benchmark option: ${flag}`);
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
  if (Boolean(verifyResult) !== Boolean(ledger)) {
    throw new Error("--verify-result and --ledger must be used together");
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
      ? { timeoutMs: parseTimeout(values.get("--timeout-ms")) }
      : {}),
    ...(verifyResult
      ? {
          verifyResult: path.resolve(verifyResult),
          ledger: path.resolve(ledger),
        }
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

function parseTimeout(value) {
  if (!/^[0-9]+$/u.test(value)) {
    throw new Error("--timeout-ms must be a positive integer");
  }
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000) {
    throw new Error("--timeout-ms must be a positive integer");
  }
  return timeoutMs;
}

async function readJson(filePath, maxBytes) {
  const info = await stat(filePath);
  if (!info.isFile() || info.size > maxBytes) {
    throw new Error("Coding benchmark artifact exceeds its size limit");
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}
