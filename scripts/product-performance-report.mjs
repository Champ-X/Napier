import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";

const MAX_BUDGET_BYTES = 64 * 1024;
const MAX_REPORT_BYTES = 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;

export const PRODUCT_PERFORMANCE_METRICS = Object.freeze([
  { name: "cliFirstEventMedianMs", unit: "ms" },
  { name: "cliFirstTokenMedianMs", unit: "ms" },
  { name: "cliCompletionMedianMs", unit: "ms" },
  { name: "runtimeBootstrapMs", unit: "ms" },
  { name: "readFileP95Ms", unit: "ms" },
  { name: "longThreadAppendP95Ms", unit: "ms" },
  { name: "longThreadProjectionMs", unit: "ms" },
  { name: "runtimeObservedPeakRssBytes", unit: "bytes" },
  { name: "runtimeRssGrowthBytes", unit: "bytes" },
  { name: "databaseBytes", unit: "bytes" },
  { name: "databaseBytesPerEvent", unit: "bytes/event" },
]);

export async function readProductPerformanceBudget(filePath) {
  return validateProductPerformanceBudget(
    await readBoundedJson(filePath, MAX_BUDGET_BYTES, "Performance budget"),
  );
}

export function validateProductPerformanceBudget(input) {
  const budget = exactRecord(
    input,
    ["kind", "schemaVersion", "profile", "sample", "limits"],
    "Performance budget",
  );
  if (
    budget.kind !== "napier.product-performance-budget" ||
    budget.schemaVersion !== 1 ||
    typeof budget.profile !== "string" ||
    !/^[a-z][a-z0-9_-]{0,63}$/u.test(budget.profile)
  ) {
    throw new Error("Performance budget identity is invalid");
  }
  const sample = exactRecord(
    budget.sample,
    [
      "cliIterations",
      "cliTimeoutMs",
      "readFileIterations",
      "longThreadEventCount",
    ],
    "Performance budget sample",
  );
  integerInRange(sample.cliIterations, 1, 5, "cliIterations");
  integerInRange(sample.cliTimeoutMs, 1_000, 30_000, "cliTimeoutMs");
  integerInRange(sample.readFileIterations, 1, 100, "readFileIterations");
  integerInRange(
    sample.longThreadEventCount,
    100,
    10_000,
    "longThreadEventCount",
  );
  const limits = exactRecord(
    budget.limits,
    PRODUCT_PERFORMANCE_METRICS.map((metric) => metric.name),
    "Performance budget limits",
  );
  for (const metric of PRODUCT_PERFORMANCE_METRICS) {
    finitePositive(limits[metric.name], `Performance limit ${metric.name}`);
  }
  return structuredClone(budget);
}

export function createProductPerformanceReport({
  budget: inputBudget,
  measurements: inputMeasurements,
  environment: inputEnvironment,
  generatedAt,
}) {
  const budget = validateProductPerformanceBudget(inputBudget);
  const environment = exactRecord(
    inputEnvironment,
    ["nodeVersion", "platform", "arch"],
    "Performance environment",
  );
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value !== "string" || value.length === 0 || value.length > 80) {
      throw new Error(`Performance environment ${key} is invalid`);
    }
  }
  if (
    typeof generatedAt !== "string" ||
    !Number.isFinite(Date.parse(generatedAt))
  ) {
    throw new Error("Performance report generatedAt is invalid");
  }
  const measurements = validateMeasurements(inputMeasurements, budget.sample);
  const metrics = {
    cliFirstEventMedianMs: measurements.cli.firstEventMedianMs,
    cliFirstTokenMedianMs: measurements.cli.firstTokenMedianMs,
    cliCompletionMedianMs: measurements.cli.completionMedianMs,
    runtimeBootstrapMs: measurements.runtime.bootstrapMs,
    readFileP95Ms: measurements.tool.p95Ms,
    longThreadAppendP95Ms: measurements.longThread.appendP95Ms,
    longThreadProjectionMs: measurements.longThread.projectionMs,
    runtimeObservedPeakRssBytes: measurements.memory.observedPeakRssBytes,
    runtimeRssGrowthBytes: measurements.memory.rssGrowthBytes,
    databaseBytes: measurements.database.totalBytes,
    databaseBytesPerEvent: measurements.database.bytesPerEvent,
  };
  const checks = PRODUCT_PERFORMANCE_METRICS.map((metric) => ({
    metric: metric.name,
    unit: metric.unit,
    observed: metrics[metric.name],
    limit: budget.limits[metric.name],
    passed: metrics[metric.name] <= budget.limits[metric.name],
  }));
  const content = {
    kind: "napier.product-performance-report",
    schemaVersion: 1,
    generatedAt,
    environment: structuredClone(environment),
    profile: budget.profile,
    budgetSha256: sha256(stableJson(budget)),
    sample: structuredClone(budget.sample),
    measurements,
    metrics,
    checks,
    status: checks.every((check) => check.passed) ? "passed" : "failed",
  };
  return {
    ...content,
    contentSha256: sha256(stableJson(content)),
  };
}

export function verifyProductPerformanceReport(report, inputBudget) {
  const errors = [];
  let expected;
  try {
    const budget = validateProductPerformanceBudget(inputBudget);
    const candidate = exactRecord(
      report,
      [
        "kind",
        "schemaVersion",
        "generatedAt",
        "environment",
        "profile",
        "budgetSha256",
        "sample",
        "measurements",
        "metrics",
        "checks",
        "status",
        "contentSha256",
      ],
      "Performance report",
    );
    if (!SHA256.test(String(candidate.contentSha256))) {
      errors.push("report_content_hash_invalid");
    }
    const { contentSha256: candidateContentSha256, ...candidateContent } =
      candidate;
    if (sha256(stableJson(candidateContent)) !== candidateContentSha256) {
      errors.push("report_content_hash_mismatch");
    }
    expected = createProductPerformanceReport({
      budget,
      measurements: candidate.measurements,
      environment: candidate.environment,
      generatedAt: candidate.generatedAt,
    });
    if (candidate.budgetSha256 !== expected.budgetSha256) {
      errors.push("report_budget_mismatch");
    }
    if (stableJson(candidate) !== stableJson(expected)) {
      errors.push("report_projection_mismatch");
    }
    if (candidate.status !== "passed") {
      errors.push("report_budget_failed");
    }
  } catch (error) {
    errors.push(`report_invalid:${errorMessage(error)}`);
  }
  return {
    valid: errors.length === 0,
    errors,
    ...(expected ? { expected } : {}),
  };
}

export async function verifyProductPerformanceReportFile(options) {
  const errors = [];
  let budget;
  let report;
  let reportBytes = Buffer.alloc(0);
  try {
    budget = await readProductPerformanceBudget(options.budgetPath);
  } catch (error) {
    errors.push(`budget:${errorMessage(error)}`);
  }
  try {
    const file = await readBoundedFile(
      options.reportPath,
      MAX_REPORT_BYTES,
      "Performance report",
    );
    reportBytes = file;
    report = JSON.parse(file.toString("utf8"));
  } catch (error) {
    errors.push(`report:${errorMessage(error)}`);
  }
  if (budget !== undefined && report !== undefined) {
    errors.push(...verifyProductPerformanceReport(report, budget).errors);
  }
  return {
    valid: errors.length === 0,
    errors,
    report,
    reportSha256: sha256(reportBytes),
  };
}

function validateMeasurements(input, sample) {
  const measurements = exactRecord(
    input,
    ["cli", "runtime", "tool", "longThread", "memory", "database"],
    "Performance measurements",
  );
  const cli = exactRecord(
    measurements.cli,
    [
      "sampleCount",
      "samples",
      "firstEventMedianMs",
      "firstTokenMedianMs",
      "completionMedianMs",
    ],
    "CLI performance measurements",
  );
  if (
    cli.sampleCount !== sample.cliIterations ||
    !Array.isArray(cli.samples) ||
    cli.samples.length !== sample.cliIterations
  ) {
    throw new Error("CLI performance sample count is invalid");
  }
  const cliSamples = cli.samples.map((entry) => {
    const item = exactRecord(
      entry,
      ["firstEventMs", "firstTokenMs", "completionMs", "eventCount"],
      "CLI performance sample",
    );
    nonNegativeNumber(item.firstEventMs, "CLI first event");
    nonNegativeNumber(item.firstTokenMs, "CLI first token");
    nonNegativeNumber(item.completionMs, "CLI completion");
    integerInRange(item.eventCount, 1, 10_000, "CLI eventCount");
    if (
      item.firstEventMs > item.firstTokenMs ||
      item.firstTokenMs > item.completionMs
    ) {
      throw new Error("CLI performance timing order is invalid");
    }
    return structuredClone(item);
  });
  const expectedCli = {
    firstEventMedianMs: percentile(
      cliSamples.map((entry) => entry.firstEventMs),
      0.5,
    ),
    firstTokenMedianMs: percentile(
      cliSamples.map((entry) => entry.firstTokenMs),
      0.5,
    ),
    completionMedianMs: percentile(
      cliSamples.map((entry) => entry.completionMs),
      0.5,
    ),
  };
  for (const [key, value] of Object.entries(expectedCli)) {
    if (cli[key] !== value) {
      throw new Error(`CLI performance ${key} is invalid`);
    }
  }

  const runtime = numericRecord(
    measurements.runtime,
    ["moduleLoadMs", "bootstrapMs"],
    "Runtime performance measurements",
  );
  const tool = exactRecord(
    measurements.tool,
    ["name", "iterations", "durationsMs", "p50Ms", "p95Ms"],
    "Tool performance measurements",
  );
  if (
    tool.name !== "read_file" ||
    tool.iterations !== sample.readFileIterations ||
    !Array.isArray(tool.durationsMs) ||
    tool.durationsMs.length !== sample.readFileIterations
  ) {
    throw new Error("Tool performance sample is invalid");
  }
  const toolDurations = tool.durationsMs.map((value) => {
    nonNegativeNumber(value, "Tool duration");
    return value;
  });
  if (
    tool.p50Ms !== percentile(toolDurations, 0.5) ||
    tool.p95Ms !== percentile(toolDurations, 0.95)
  ) {
    throw new Error("Tool performance percentile is invalid");
  }

  const longThread = numericRecord(
    measurements.longThread,
    [
      "eventCount",
      "batchDurationMs",
      "appendP50Ms",
      "appendP95Ms",
      "projectionMs",
      "detailBytes",
      "eventBytes",
    ],
    "Long-Thread performance measurements",
  );
  if (longThread.eventCount !== sample.longThreadEventCount) {
    throw new Error("Long-Thread event count is invalid");
  }
  const memory = numericRecord(
    measurements.memory,
    [
      "initialRssBytes",
      "afterModuleLoadRssBytes",
      "afterBootstrapRssBytes",
      "afterToolRssBytes",
      "afterLongThreadRssBytes",
      "observedPeakRssBytes",
      "rssGrowthBytes",
    ],
    "Memory performance measurements",
  );
  const observedPeakRssBytes = Math.max(
    memory.initialRssBytes,
    memory.afterModuleLoadRssBytes,
    memory.afterBootstrapRssBytes,
    memory.afterToolRssBytes,
    memory.afterLongThreadRssBytes,
  );
  if (
    memory.observedPeakRssBytes !== observedPeakRssBytes ||
    memory.rssGrowthBytes !==
      Math.max(0, observedPeakRssBytes - memory.initialRssBytes)
  ) {
    throw new Error("Memory performance aggregate is invalid");
  }
  const database = numericRecord(
    measurements.database,
    ["eventCount", "totalBytes", "bytesPerEvent"],
    "Database performance measurements",
  );
  if (
    database.eventCount !== sample.longThreadEventCount ||
    database.bytesPerEvent !== round(database.totalBytes / database.eventCount)
  ) {
    throw new Error("Database performance aggregate is invalid");
  }
  return {
    cli: {
      sampleCount: cli.sampleCount,
      samples: cliSamples,
      ...expectedCli,
    },
    runtime,
    tool: {
      name: tool.name,
      iterations: tool.iterations,
      durationsMs: [...toolDurations],
      p50Ms: tool.p50Ms,
      p95Ms: tool.p95Ms,
    },
    longThread,
    memory,
    database,
  };
}

async function readBoundedJson(filePath, maxBytes, label) {
  const content = await readBoundedFile(filePath, maxBytes, label);
  try {
    return JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

async function readBoundedFile(filePath, maxBytes, label) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  if (info.size > maxBytes) {
    throw new Error(`${label} exceeds ${String(maxBytes)} bytes`);
  }
  return readFile(filePath);
}

function numericRecord(input, keys, label) {
  const value = exactRecord(input, keys, label);
  for (const key of keys) {
    nonNegativeNumber(value[key], `${label} ${key}`);
  }
  return structuredClone(value);
}

function exactRecord(input, keys, label) {
  if (!isRecord(input)) throw new Error(`${label} must be an object`);
  const actualKeys = Object.keys(input).sort();
  const expectedKeys = [...keys].sort();
  if (stableJson(actualKeys) !== stableJson(expectedKeys)) {
    throw new Error(`${label} has unexpected fields`);
  }
  return input;
}

function integerInRange(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${label} must be an integer from ${String(minimum)} to ${String(maximum)}`,
    );
  }
}

function finitePositive(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
}

function nonNegativeNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
}

function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1),
  );
  return round(sorted[index]);
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map((item) => sortJson(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)]),
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
