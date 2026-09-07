import type { TraceTrajectoryEvent } from "./trace-trajectory-model";
import { traceTrajectoryModelUsageEvidence } from "./trace-trajectory-event-performance";

export interface TraceTrajectoryUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

/** Usage belongs to model responses; route and message receipts repeat it. */
export function traceTrajectoryUsage(payload: unknown): TraceTrajectoryUsage {
  const evidence = new Map(
    traceTrajectoryModelUsageEvidence(payload).map((field) => [
      field.key,
      field.value,
    ]),
  );
  const result: TraceTrajectoryUsage = {};
  for (const key of [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "totalTokens",
  ] as const) {
    const value = evidence.get(key);
    if (value !== undefined) result[key] = Number(value);
  }
  if (result.totalTokens === undefined && Object.keys(result).length > 0) {
    result.totalTokens = 0;
  }
  const source = record(payload);
  const usage = record(source?.["usage"]);
  const accounting = record(source?.["usageAccounting"]);
  const cost = usage?.["costUsd"] ?? accounting?.["reportedCostUsd"];
  if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) {
    result.costUsd = cost;
  }
  return result;
}

export function traceTrajectoryInsights(
  events: readonly TraceTrajectoryEvent[],
) {
  const usage: TraceTrajectoryUsage = {};
  const tools = new Set<string>();
  const models = new Set<string>();
  const seen = new Set<string>();
  let responses = 0;
  let measuredResponses = 0;
  let exceptions = 0;
  for (const item of events) {
    const event = item.event;
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    if (item.status === "failed") exceptions += 1;
    const payload = record(event.payload);
    if (
      [
        "tool.started",
        "tool.completed",
        "tool.failed",
        "tool.blocked",
        "tool.result_reused",
      ].includes(event.type)
    ) {
      tools.add(
        `${event.runId}\0${typeof payload?.["callId"] === "string" ? payload["callId"] : event.id}`,
      );
    }
    if (event.type !== "model.response") continue;
    responses += 1;
    const current = traceTrajectoryUsage(event.payload);
    if (current.totalTokens !== undefined) measuredResponses += 1;
    for (const key of Object.keys(current) as (keyof TraceTrajectoryUsage)[]) {
      usage[key] = (usage[key] ?? 0) + current[key]!;
    }
    if (typeof payload?.["model"] === "string") models.add(payload["model"]);
  }
  return {
    usage,
    responses,
    measuredResponses,
    toolCalls: tools.size,
    exceptions,
    models: [...models],
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
