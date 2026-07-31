import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  readProductPerformanceBudget,
  runProductPerformanceBenchmark,
  verifyProductPerformanceReportFile,
} from "./product-performance.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultBudgetPath = path.join(
  repoRoot,
  "docs/product-performance-budget.json",
);

async function runCli() {
  const options = parseArgs(process.argv.slice(2));
  const budgetPath = path.resolve(options.budgetPath ?? defaultBudgetPath);
  if (options.verifyPath) {
    const verification = await verifyProductPerformanceReportFile({
      budgetPath,
      reportPath: path.resolve(options.verifyPath),
    });
    process.stdout.write(
      options.json
        ? `${JSON.stringify(verification, null, 2)}\n`
        : verification.valid
          ? `Product performance baseline verified: ${verification.reportSha256.slice(0, 16)}\n`
          : `Product performance baseline invalid: ${verification.errors.join(", ")}\n`,
    );
    if (!verification.valid) process.exitCode = 1;
    return;
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const budget = await readProductPerformanceBudget(budgetPath);
    const report = await runProductPerformanceBenchmark({
      repoRoot,
      budget,
      signal: controller.signal,
    });
    if (options.outputPath) {
      const outputPath = path.resolve(options.outputPath);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(
        outputPath,
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8",
      );
    }
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(
        [
          `Product performance ${report.status}`,
          `CLI first event ${formatMs(report.metrics.cliFirstEventMedianMs)}`,
          `first token ${formatMs(report.metrics.cliFirstTokenMedianMs)}`,
          `complete ${formatMs(report.metrics.cliCompletionMedianMs)}`,
          `read p95 ${formatMs(report.metrics.readFileP95Ms)}`,
          `1k projection ${formatMs(report.metrics.longThreadProjectionMs)}`,
          `DB/event ${String(report.metrics.databaseBytesPerEvent)} B`,
          `report ${report.contentSha256.slice(0, 16)}`,
          ...(options.outputPath
            ? [`output ${path.resolve(options.outputPath)}`]
            : []),
        ].join("; ") + "\n",
      );
      for (const check of report.checks.filter(
        (candidate) => !candidate.passed,
      )) {
        process.stderr.write(
          `Performance budget exceeded: ${check.metric} ${String(check.observed)} > ${String(check.limit)} ${check.unit}\n`,
        );
      }
    }
    if (report.status !== "passed") process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

function parseArgs(args) {
  const options = { json: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (seen.has(name)) {
      throw new Error(`Duplicate product performance option: ${name}`);
    }
    seen.add(name);
    if (name === "--json") {
      options.json = true;
      continue;
    }
    if (!["--budget", "--output", "--verify"].includes(name)) {
      throw new Error(`Unknown product performance option: ${name}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    if (name === "--budget") options.budgetPath = value;
    if (name === "--output") options.outputPath = value;
    if (name === "--verify") options.verifyPath = value;
    index += 1;
  }
  if (options.verifyPath && options.outputPath) {
    throw new Error("--verify cannot be combined with --output");
  }
  return options;
}

function formatMs(value) {
  return `${value.toFixed(1)} ms`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    await runCli();
  } catch (error) {
    process.stderr.write(
      `Product performance benchmark failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  }
}
