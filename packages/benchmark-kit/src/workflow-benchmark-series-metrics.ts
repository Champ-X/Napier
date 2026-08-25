import type {
  WorkflowBenchmarkMetricSummary,
  WorkflowBenchmarkResult,
  WorkflowBenchmarkSeries,
} from "./workflow-benchmark-types.js";

const METRIC_KEYS = keySet(
  "durationMs costUsd inputTokens outputTokens runCount",
);
const SUMMARY_KEYS = keySet("total min p50 p95 max mean");

export function createWorkflowBenchmarkSeriesMetrics(
  results: WorkflowBenchmarkResult[],
  includeUsageSampleCount: boolean,
): Pick<WorkflowBenchmarkSeries, "metrics" | "usageSampleCount"> {
  const usageResults = includeUsageSampleCount
    ? results.filter(hasCompleteWorkflowBenchmarkUsage)
    : results;
  return {
    ...(includeUsageSampleCount
      ? { usageSampleCount: usageResults.length }
      : {}),
    metrics: {
      durationMs: summarize(results.map((result) => result.run.durationMs)),
      costUsd: summarizeOrZero(
        usageResults.map((result) => result.run.usage.costUsd),
      ),
      inputTokens: summarizeOrZero(
        usageResults.map((result) => result.run.usage.inputTokens),
      ),
      outputTokens: summarizeOrZero(
        usageResults.map((result) => result.run.usage.outputTokens),
      ),
      runCount: summarize(results.map((result) => result.run.runCount)),
    },
  };
}

export function validWorkflowBenchmarkSeriesMetrics(value: unknown): boolean {
  return (
    exactRecord(value, METRIC_KEYS) &&
    METRIC_KEYS.every((key) => validMetricSummary(value[key]))
  );
}

function validMetricSummary(value: unknown): boolean {
  return (
    exactRecord(value, SUMMARY_KEYS) &&
    SUMMARY_KEYS.every((key) => nonNegativeNumber(value[key])) &&
    Number(value["min"]) <= Number(value["p50"]) &&
    Number(value["p50"]) <= Number(value["p95"]) &&
    Number(value["p95"]) <= Number(value["max"])
  );
}

function summarize(values: number[]): WorkflowBenchmarkMetricSummary {
  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    total,
    min: sorted[0]!,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1)!,
    mean: total / sorted.length,
  };
}

function summarizeOrZero(values: number[]): WorkflowBenchmarkMetricSummary {
  return values.length > 0
    ? summarize(values)
    : { total: 0, min: 0, p50: 0, p95: 0, max: 0, mean: 0 };
}

function hasCompleteWorkflowBenchmarkUsage(
  result: WorkflowBenchmarkResult,
): boolean {
  const responseCount = result.evaluation.modelResponseCount;
  return (
    responseCount === undefined ||
    result.evaluation.modelResponseUsageSampleCount === responseCount
  );
}

function percentile(sorted: number[], rate: number): number {
  return sorted[Math.ceil(sorted.length * rate) - 1]!;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function keySet(value: string): readonly string[] {
  return value.split(" ");
}
