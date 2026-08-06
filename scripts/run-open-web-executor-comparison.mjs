#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";

import {
  createOpenWebComparisonAttemptReceipt,
  openWebComparisonAttemptFileName,
  verifyOpenWebComparisonAttemptReceipt,
} from "./open-web-comparison-attempt.mjs";
import { loadOpenWebComparisonAttemptReceipt } from "./open-web-comparison-attempt-artifacts.mjs";
import {
  createOpenWebComparisonReport,
  diagnoseOpenWebComparisonCases,
  openWebComparisonSummary,
  verifyOpenWebComparisonReport,
} from "./open-web-comparison-report.mjs";
import { OPEN_WEB_COMPARISON_NOTES_V2 } from "./open-web-comparison-report-policy.mjs";
import { createOpenWebComparisonBrowserRuntime } from "./open-web-comparison-browser-runtime.mjs";
import { createOpenWebComparisonOmpRuntime } from "./open-web-comparison-omp-runtime.mjs";
import {
  createOpenWebComparisonSuite,
  publicOpenWebComparisonSuite,
} from "./open-web-comparison-suite.mjs";
import { runOpenWebComparisonTrial } from "./open-web-comparison-trial.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const TRACKS = ["default", "controlled"];

export async function runOpenWebExecutorComparison(input) {
  const secret = process.env[input.credentialEnv]?.trim();
  if (!secret) {
    throw new Error(
      "Open-web comparison credential environment variable is unavailable",
    );
  }
  const [ompExecutable, bunExecutable, napierEntry] = await Promise.all([
    resolveExecutable(input.ompExecutable),
    resolveExecutable(input.bunExecutable),
    realpath(path.join(repoRoot, "apps/cli/dist/index.js")),
  ]);
  const ompEntry = await realpath(ompExecutable);
  const ompVersion = await installedOmpVersion(ompEntry);
  const suite = createOpenWebComparisonSuite(input.seed);
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "napier-open-web-comparison-"),
  );
  let environment;
  const cases = [];
  try {
    const ompRuntime = await createOpenWebComparisonOmpRuntime({
      temporaryRoot,
      installedEntry: ompEntry,
    });
    const browserRuntime = await createOpenWebComparisonBrowserRuntime({
      temporaryRoot,
    });
    if (ompRuntime.packageVersion !== ompVersion) {
      throw new Error("OMP version and runtime image version differ");
    }
    environment = {
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.versions.node,
      napierVersion: "0.1.0",
      ompVersion,
      ompExecutableSha256: await fileSha256(ompEntry),
      ompRuntimeExecutableSha256: ompRuntime.executableSha256,
      ompRuntimeVersion: ompRuntime.packageVersion,
      browserRuntimeExecutableSha256: browserRuntime.executableSha256,
      browserRuntimeSetSha256: browserRuntime.runtimeSetSha256,
      browserRuntimeFileCount: browserRuntime.fileCount,
      browserRuntimeBytes: browserRuntime.totalBytes,
      outerSandbox: "macos-sandbox-exec-guarded",
    };
    for (let caseIndex = 0; caseIndex < suite.cases.length; caseIndex += 1) {
      const benchmarkCase = suite.cases[caseIndex];
      const tracks = [];
      for (let trackIndex = 0; trackIndex < TRACKS.length; trackIndex += 1) {
        const track = TRACKS[trackIndex];
        const trials = [];
        for (let trial = 1; trial <= input.trialCount; trial += 1) {
          const order =
            (trial + trackIndex + caseIndex) % 2 === 0
              ? ["omp", "napier"]
              : ["napier", "omp"];
          const outcomes = {};
          for (const executor of order) {
            outcomes[executor] = await runOpenWebComparisonTrial({
              executor,
              track,
              trial,
              benchmarkCase,
              temporaryRoot,
              timeoutMs: input.timeoutMs,
              credentialEnv: input.credentialEnv,
              env: process.env,
              secret,
              napierEntry,
              ompEntry,
              ompRuntime,
              browserRuntime,
              bunExecutable,
              signal: input.signal,
            });
          }
          trials.push({
            trial,
            order,
            napier: outcomes.napier,
            omp: outcomes.omp,
          });
        }
        tracks.push({ track, trials });
      }
      cases.push({
        caseId: benchmarkCase.id,
        complexity: benchmarkCase.complexity,
        taskFamily: benchmarkCase.taskFamily,
        promptSha256: benchmarkCase.promptSha256,
        oracleSha256: benchmarkCase.oracleSha256,
        caseSha256: benchmarkCase.caseSha256,
        tracks,
      });
    }
    const generatedAt = new Date().toISOString();
    const content = {
      type: "napier.open-web-executor-comparison",
      schemaVersion: 2,
      generatedAt,
      seed: input.seed,
      trialCount: input.trialCount,
      timeoutMs: input.timeoutMs,
      model: { provider: "deepseek", id: "deepseek-v4-flash" },
      suite: publicOpenWebComparisonSuite(suite),
      environment,
      cases,
      summary: openWebComparisonSummary(cases),
      notes: OPEN_WEB_COMPARISON_NOTES_V2,
    };
    let report;
    try {
      report = createOpenWebComparisonReport(content);
    } catch (error) {
      const verification = verifyOpenWebComparisonReport({
        ...content,
        contentSha256: sha256(canonicalJson(content)),
      });
      const attempt = createOpenWebComparisonAttemptReceipt({
        generatedAt,
        seed: input.seed,
        trialCount: input.trialCount,
        timeoutMs: input.timeoutMs,
        model: content.model,
        environment: content.environment,
        status: "report_invalid",
        diagnosticScope: "captured_before_cleanup",
        diagnostics: verification.diagnostics,
        caseDiagnostics: diagnoseOpenWebComparisonCases(
          cases,
          suite,
          input.trialCount,
          content.schemaVersion,
          content.environment,
        ),
      });
      const attemptPath = await writeOpenWebComparisonAttempt(attempt);
      throw new Error(
        `Open-web comparison report finalization failed; attempt receipt: ${path.relative(
          repoRoot,
          attemptPath,
        )}; diagnostics: ${verification.diagnostics.join(
          ",",
        )}; cases: ${attempt.caseDiagnostics.join(",")}`,
        { cause: error },
      );
    }
    const outputPath = path.resolve(
      input.outputPath ??
        path.join(
          repoRoot,
          "benchmark-results",
          `napier-open-web-executor-comparison-seed-${String(input.seed)}.json`,
        ),
    );
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return { report, outputPath };
  } catch (error) {
    if (
      input.signal?.aborted &&
      environment &&
      !String(error).includes("attempt receipt:")
    ) {
      const attempt = createOpenWebComparisonAttemptReceipt({
        generatedAt: new Date().toISOString(),
        seed: input.seed,
        trialCount: input.trialCount,
        timeoutMs: input.timeoutMs,
        model: { provider: "deepseek", id: "deepseek-v4-flash" },
        environment,
        status: "cancelled",
        diagnosticScope: "captured_before_cleanup",
        diagnostics: [
          "comparison_cancelled",
          ...(input.abortDiagnostic ? [input.abortDiagnostic] : []),
        ],
        caseDiagnostics: [
          cases.length === 0 ? "cases.not_started" : "cases.incomplete",
        ],
      });
      const attemptPath = await writeOpenWebComparisonAttempt(attempt);
      throw new Error(
        `Open-web comparison was cancelled; attempt receipt: ${path.relative(
          repoRoot,
          attemptPath,
        )}`,
        { cause: error },
      );
    }
    if (environment && !String(error).includes("attempt receipt:")) {
      const attempt = createOpenWebComparisonAttemptReceipt({
        generatedAt: new Date().toISOString(),
        seed: input.seed,
        trialCount: input.trialCount,
        timeoutMs: input.timeoutMs,
        model: { provider: "deepseek", id: "deepseek-v4-flash" },
        environment,
        status: "execution_aborted",
        diagnosticScope: "captured_before_cleanup",
        diagnostics: ["trial_execution_aborted"],
        caseDiagnostics: [
          cases.length === 0 ? "cases.not_started" : "cases.incomplete",
        ],
      });
      const attemptPath = await writeOpenWebComparisonAttempt(attempt);
      throw new Error(
        `Open-web comparison execution aborted; attempt receipt: ${path.relative(
          repoRoot,
          attemptPath,
        )}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function writeOpenWebComparisonAttempt(attempt) {
  const attemptPath = path.join(
    repoRoot,
    "benchmark-results",
    openWebComparisonAttemptFileName(attempt),
  );
  await mkdir(path.dirname(attemptPath), { recursive: true });
  await writeFile(attemptPath, `${JSON.stringify(attempt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  return attemptPath;
}

function parseArgs(argv) {
  const values = new Map();
  const allowed = new Set([
    "--seed",
    "--trials",
    "--timeout-ms",
    "--output",
    "--credential-env",
    "--omp",
    "--bun",
    "--verify",
    "--verify-attempt",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || !value || value.startsWith("--")) {
      throw new Error("Invalid open-web comparison option");
    }
    if (values.has(flag)) {
      throw new Error(`Duplicate open-web comparison option: ${flag}`);
    }
    values.set(flag, value);
  }
  if (
    (values.has("--verify") || values.has("--verify-attempt")) &&
    values.size !== 1
  ) {
    throw new Error(
      "Verification options cannot be combined with execution options",
    );
  }
  if (values.has("--verify") && values.has("--verify-attempt")) {
    throw new Error("Only one verification option may be used");
  }
  const seed = positiveInteger(values.get("--seed") ?? "20260805", "--seed");
  const trialCount = positiveInteger(values.get("--trials") ?? "2", "--trials");
  const timeoutMs = positiveInteger(
    values.get("--timeout-ms") ?? "180000",
    "--timeout-ms",
  );
  if (trialCount > 3) throw new Error("--trials must be 1-3");
  if (timeoutMs < 10_000 || timeoutMs > 300_000) {
    throw new Error("--timeout-ms must be 10000-300000");
  }
  const credentialEnv = values.get("--credential-env") ?? "DEEPSEEK_API_KEY";
  if (!/^[A-Z_][A-Z0-9_]{1,127}$/u.test(credentialEnv)) {
    throw new Error("--credential-env is invalid");
  }
  return {
    seed,
    trialCount,
    timeoutMs,
    credentialEnv,
    ompExecutable: values.get("--omp") ?? "omp",
    bunExecutable: values.get("--bun") ?? "bun",
    ...(values.has("--output")
      ? { outputPath: path.resolve(values.get("--output")) }
      : {}),
    ...(values.has("--verify")
      ? { verifyPath: path.resolve(values.get("--verify")) }
      : {}),
    ...(values.has("--verify-attempt")
      ? { verifyAttemptPath: path.resolve(values.get("--verify-attempt")) }
      : {}),
  };
}

async function installedOmpVersion(entry) {
  const packagePath = path.resolve(path.dirname(entry), "../package.json");
  const parsed = JSON.parse(await readFile(packagePath, "utf8"));
  if (
    !parsed ||
    typeof parsed !== "object" ||
    parsed.name !== "@oh-my-pi/pi-coding-agent" ||
    typeof parsed.version !== "string" ||
    !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(parsed.version)
  ) {
    throw new Error("Installed OMP package manifest is invalid");
  }
  return parsed.version;
}

async function resolveExecutable(value) {
  if (path.isAbsolute(value)) return realpath(value);
  const result = await execFileAsync("/usr/bin/which", [value], {
    timeout: 5_000,
    maxBuffer: 64 * 1024,
    encoding: "utf8",
  });
  const resolved = result.stdout.trim();
  if (!resolved) throw new Error(`Executable is unavailable: ${value}`);
  return realpath(resolved);
}

async function fileSha256(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function positiveInteger(value, label) {
  if (!/^[0-9]+$/u.test(value)) throw new Error(`${label} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be positive`);
  }
  return parsed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.verifyPath) {
    const report = JSON.parse(await readFile(options.verifyPath, "utf8"));
    const verification = verifyOpenWebComparisonReport(report);
    process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
    if (!verification.valid) process.exitCode = 1;
  } else if (options.verifyAttemptPath) {
    const attempt = await loadOpenWebComparisonAttemptReceipt(
      options.verifyAttemptPath,
    );
    const verification = verifyOpenWebComparisonAttemptReceipt(attempt);
    process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
    if (!verification.valid) process.exitCode = 1;
  } else {
    const controller = new AbortController();
    let signalName;
    const abort = (received) => {
      signalName ??= received;
      controller.abort();
    };
    const onSigint = () => abort("SIGINT");
    const onSigterm = () => abort("SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    try {
      const result = await runOpenWebExecutorComparison({
        ...options,
        signal: controller.signal,
      });
      process.stdout.write(
        `${JSON.stringify(
          {
            outputPath: path.relative(repoRoot, result.outputPath),
            summary: result.report.summary,
            contentSha256: result.report.contentSha256,
          },
          null,
          2,
        )}\n`,
      );
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      if (!signalName) process.exitCode = 1;
    } finally {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      if (signalName) process.exitCode = signalName === "SIGINT" ? 130 : 143;
    }
  }
}
