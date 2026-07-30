import type {
  CodingBenchmarkMetricSummary,
  CodingBenchmarkSeriesMetrics,
} from "./coding-benchmark-series-types.js";
import type { CodingBenchmarkResult } from "./coding-benchmark-types.js";

const METRIC_KEYS = keySet(
  "durationMs costUsd inputTokens outputTokens cacheReadTokens cacheWriteTokens toolStarted toolCompleted toolFailed toolBlocked repeatedToolCalls",
);
const SUMMARY_KEYS = keySet("total min p50 p95 max mean");

export function createCodingBenchmarkSeriesMetrics(
  results: readonly CodingBenchmarkResult[],
): CodingBenchmarkSeriesMetrics {
  return {
    durationMs: summarize(results.map((result) => result.run.durationMs)),
    costUsd: summarize(results.map((result) => result.run.usage.costUsd)),
    inputTokens: summarize(
      results.map((result) => result.run.usage.inputTokens),
    ),
    outputTokens: summarize(
      results.map((result) => result.run.usage.outputTokens),
    ),
    cacheReadTokens: summarize(
      results.map((result) => result.run.usage.cacheReadTokens),
    ),
    cacheWriteTokens: summarize(
      results.map((result) => result.run.usage.cacheWriteTokens),
    ),
    toolStarted: summarize(results.map((result) => result.tooling.started)),
    toolCompleted: summarize(results.map((result) => result.tooling.completed)),
    toolFailed: summarize(results.map((result) => result.tooling.failed)),
    toolBlocked: summarize(results.map((result) => result.tooling.blocked)),
    repeatedToolCalls: summarize(
      results.map((result) => result.tooling.repeatedCallCount),
    ),
  };
}

export function validCodingBenchmarkSeriesMetrics(
  value: unknown,
): value is CodingBenchmarkSeriesMetrics {
  return (
    exactRecord(value, METRIC_KEYS) &&
    METRIC_KEYS.every((key) => validSummary(value[key]))
  );
}

function summarize(values: readonly number[]): CodingBenchmarkMetricSummary {
  const sorted = [...values].sort((left, right) => left - right);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    total,
    min: sorted[0]!,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1)!,
    mean: total / values.length,
  };
}

function percentile(sorted: readonly number[], value: number): number {
  return sorted[Math.ceil(value * sorted.length) - 1]!;
}

function validSummary(value: unknown): boolean {
  return (
    exactRecord(value, SUMMARY_KEYS) &&
    SUMMARY_KEYS.every((key) => nonNegativeNumber(value[key]))
  );
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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

function keySet(value: string): readonly string[] {
  return value.split(" ");
}
