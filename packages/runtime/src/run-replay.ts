import { createHash } from "node:crypto";

import {
  emptyUsage,
  traceSummaryBoundaryDelta,
  type JsonValue,
  type RunComparison,
  type RunContextCoverageDelta,
  type RunContextCoverageSummary,
  type RunEvent,
  type RunMetricDelta,
  type RunMetrics,
  type RunReplaySnapshot,
  type SubagentTask,
  type Usage,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { MODEL_CONTEXT_ENVELOPE_EVENT } from "./model-context-envelope.js";
import { compareRunHarnessEffects } from "./run-harness-comparison.js";
import { projectRunHarnessEffectMetrics } from "./run-harness-effect-metrics.js";
import { compareRunConfigurations } from "./run-config.js";
import type { ReplayStorePort } from "./store-port.js";

const METRIC_KEYS: Array<keyof RunMetricDelta> = [
  "durationMs",
  "eventCount",
  "messageCount",
  "modelResponseCount",
  "modelContextEnvelopeCount",
  "embeddedModelContextEnvelopeCount",
  "modelContextBoundResponseCount",
  "modelContextUnboundResponseCount",
  "toolCallCount",
  "toolCompletedCount",
  "toolFailedCount",
  "toolBlockedCount",
  "subagentCount",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "costUsd",
];

export async function createRunReplaySnapshot(
  store: ReplayStorePort,
  threadId: string,
  runId: string,
): Promise<RunReplaySnapshot> {
  store.getThread(threadId);
  const run = store
    .listRuns(threadId)
    .find((candidate) => candidate.id === runId);
  if (!run) throw new Error(`Run not found in thread: ${runId}`);
  const events = (await store.listEvents(threadId)).filter(
    (event) => event.runId === runId,
  );
  const subagents = store.listSubagentTasks(threadId, runId);
  const content: Omit<RunReplaySnapshot, "generatedAt" | "contentSha256"> = {
    schemaVersion: 1,
    threadId,
    run,
    metrics: deriveRunMetrics(run.startedAt, run.finishedAt, events, subagents),
    events,
    subagents,
    eventStreamSha256: hashEventStream(events),
    ...(run.configuration
      ? { configurationSha256: run.configuration.contentSha256 }
      : {}),
  };
  return {
    ...content,
    generatedAt: new Date().toISOString(),
    contentSha256: hashRunReplaySnapshotContent(content),
  };
}

export async function compareRuns(
  store: ReplayStorePort,
  threadId: string,
  leftRunId: string,
  rightRunId: string,
): Promise<RunComparison> {
  if (leftRunId === rightRunId) {
    throw new Error("Run comparison requires two distinct runs");
  }
  const [left, right] = await Promise.all([
    createRunReplaySnapshot(store, threadId, leftRunId),
    createRunReplaySnapshot(store, threadId, rightRunId),
  ]);
  const metricDelta = Object.fromEntries(
    METRIC_KEYS.map((key) => [key, right.metrics[key] - left.metrics[key]]),
  ) as RunMetricDelta;
  const leftTypes = countEventTypes(left.events);
  const rightTypes = countEventTypes(right.events);
  const eventTypeDelta = Object.fromEntries(
    [...new Set([...leftTypes.keys(), ...rightTypes.keys()])]
      .sort()
      .map((type) => [
        type,
        (rightTypes.get(type) ?? 0) - (leftTypes.get(type) ?? 0),
      ]),
  );
  const leftTools = toolNames(left.events);
  const rightTools = toolNames(right.events);
  const configurationDelta = compareRunConfigurations(
    left.run.configuration,
    right.run.configuration,
  );
  const leftHarness = projectRunHarnessEffectMetrics(
    left.run,
    left.events,
    left.eventStreamSha256,
  );
  const rightHarness = projectRunHarnessEffectMetrics(
    right.run,
    right.events,
    right.eventStreamSha256,
  );
  return {
    threadId,
    left,
    right,
    metricDelta,
    outputChanged:
      left.metrics.assistantTextSha256 !== right.metrics.assistantTextSha256,
    eventTypeDelta,
    addedToolNames: [...rightTools]
      .filter((name) => !leftTools.has(name))
      .sort(),
    removedToolNames: [...leftTools]
      .filter((name) => !rightTools.has(name))
      .sort(),
    configurationDelta,
    contextCoverageDelta: compareContextCoverage(left.metrics, right.metrics),
    traceSummaryBoundaryDelta: traceSummaryBoundaryDelta(
      left.events,
      right.events,
    ),
    harness: compareRunHarnessEffects(
      left.run,
      leftHarness,
      right.run,
      rightHarness,
    ),
  };
}

export function aggregateRunUsage(
  events: RunEvent[],
  subagents: SubagentTask[],
): Usage {
  const modelResponses = events.filter(
    (event) => event.type === "model.response",
  );
  const primaryUsageEvents =
    modelResponses.length > 0
      ? modelResponses
      : events.filter((event) => event.type === "message.assistant");
  const auxiliaryUsageEvents = events.filter(
    (event) =>
      event.type === "context.compaction.completed" ||
      event.type === "context.compaction.failed" ||
      event.type === "goal.evaluated" ||
      event.type === "memory.extraction.completed" ||
      event.type === "memory.extraction.failed" ||
      event.type === "model.advisor.independent.reviewed",
  );
  return [
    ...primaryUsageEvents.map(eventUsage),
    ...auxiliaryUsageEvents.map(eventUsage),
    ...subagents.map((task) => task.usage),
  ]
    .filter((usage): usage is Usage => Boolean(usage))
    .reduce(addUsage, emptyUsage());
}

export function hashEventStream(events: RunEvent[]): string {
  return createHash("sha256")
    .update(events.map((event) => JSON.stringify(event)).join("\n"))
    .digest("hex");
}

export function hashRunReplaySnapshotContent(
  content: Omit<RunReplaySnapshot, "generatedAt" | "contentSha256">,
): string {
  return sha256(canonicalJson(content));
}

export function deriveRunMetrics(
  startedAt: string,
  finishedAt: string | undefined,
  events: RunEvent[],
  subagents: SubagentTask[],
): RunMetrics {
  const usage = aggregateRunUsage(events, subagents);
  const assistantText = events
    .filter((event) => event.type === "message.assistant")
    .flatMap((event): string[] => {
      const text = payloadString(event.payload, "text");
      return text ? [text] : [];
    })
    .join("\n");
  const lastTimestamp = finishedAt ?? events.at(-1)?.createdAt ?? startedAt;
  const modelResponses = events.filter(
    (event) => event.type === "model.response",
  );
  const modelContextEnvelopeCount = events.filter(
    (event) => event.type === MODEL_CONTEXT_ENVELOPE_EVENT,
  ).length;
  const embeddedModelContextEnvelopeCount = countEmbeddedModelContextEnvelopes({
    events,
    subagents,
  });
  const modelContextBoundResponseCount = modelResponses.filter(
    (event) =>
      Boolean(payloadString(event.payload, "modelContextEnvelopeSha256")) &&
      typeof payloadNumber(event.payload, "modelContextEnvelopeTurnIndex") ===
        "number" &&
      Boolean(payloadString(event.payload, "modelContextMessageSetSha256")) &&
      Boolean(
        payloadString(event.payload, "modelContextToolDefinitionSetSha256"),
      ),
  ).length;
  return {
    durationMs: Math.max(0, Date.parse(lastTimestamp) - Date.parse(startedAt)),
    eventCount: events.length,
    messageCount: events.filter(
      (event) =>
        event.type === "message.user" || event.type === "message.assistant",
    ).length,
    modelResponseCount: modelResponses.length,
    modelContextEnvelopeCount,
    embeddedModelContextEnvelopeCount,
    modelContextBoundResponseCount,
    modelContextUnboundResponseCount:
      modelResponses.length - modelContextBoundResponseCount,
    toolCallCount: events.filter((event) => event.type === "tool.started")
      .length,
    toolCompletedCount: events.filter(
      (event) => event.type === "tool.completed",
    ).length,
    toolFailedCount: events.filter((event) => event.type === "tool.failed")
      .length,
    toolBlockedCount: events.filter((event) => event.type === "tool.blocked")
      .length,
    subagentCount: subagents.length,
    ...usage,
    assistantTextSha256: createHash("sha256")
      .update(assistantText)
      .digest("hex"),
  };
}

function eventUsage(event: RunEvent): Usage | undefined {
  if (
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    return undefined;
  }
  const usage = event.payload["usage"];
  if (!usage || Array.isArray(usage) || typeof usage !== "object") {
    return undefined;
  }
  const values = {
    inputTokens: usage["inputTokens"],
    outputTokens: usage["outputTokens"],
    cacheReadTokens: usage["cacheReadTokens"],
    cacheWriteTokens: usage["cacheWriteTokens"],
    costUsd: usage["costUsd"],
  };
  if (
    Object.values(values).some(
      (value) => typeof value !== "number" || !Number.isFinite(value),
    )
  ) {
    return undefined;
  }
  return values as Usage;
}

function addUsage(left: Usage, right: Usage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    costUsd: left.costUsd + right.costUsd,
  };
}

function countEmbeddedModelContextEnvelopes(value: unknown): number {
  let count = 0;
  walkEmbeddedModelContextEnvelopes(value, "snapshot", () => {
    count += 1;
  });
  return count;
}

export function walkEmbeddedModelContextEnvelopes(
  value: unknown,
  path: string,
  visit: (envelope: unknown, path: string) => void,
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      walkEmbeddedModelContextEnvelopes(item, `${path}[${index}]`, visit),
    );
    return;
  }
  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "modelContextEnvelope")) {
    visit(record["modelContextEnvelope"], `${path}.modelContextEnvelope`);
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === "modelContextEnvelope") continue;
    walkEmbeddedModelContextEnvelopes(child, `${path}.${key}`, visit);
  }
}

function compareContextCoverage(
  leftMetrics: RunMetrics,
  rightMetrics: RunMetrics,
): RunContextCoverageDelta {
  const left = runContextCoverageSummary(leftMetrics);
  const right = runContextCoverageSummary(rightMetrics);
  const coverageRateDelta = right.coverageRate - left.coverageRate;
  const diagnostics: string[] = [];
  const missing =
    right.modelResponseCount > 0 &&
    right.envelopeCount === 0 &&
    right.boundResponseCount === 0;
  const regressed =
    coverageRateDelta < 0 ||
    right.unboundResponseCount > left.unboundResponseCount;
  const partial =
    right.unboundResponseCount > 0 ||
    right.coverageRate < 1 ||
    right.envelopeCount > right.boundResponseCount;
  if (missing) {
    diagnostics.push("candidate_context_envelopes_missing");
  }
  if (right.unboundResponseCount > 0) {
    diagnostics.push("candidate_context_responses_unbound");
  }
  if (right.envelopeCount > right.boundResponseCount) {
    diagnostics.push("candidate_context_envelopes_unmatched");
  }
  if (regressed) {
    diagnostics.push("candidate_context_coverage_regressed");
  }
  return {
    status: missing
      ? "missing"
      : regressed
        ? "regressed"
        : partial
          ? "partial"
          : "clean",
    left,
    right,
    coverageRateDelta,
    embeddedEnvelopeDelta:
      right.embeddedEnvelopeCount - left.embeddedEnvelopeCount,
    diagnostics,
  };
}

function runContextCoverageSummary(
  metrics: RunMetrics,
): RunContextCoverageSummary {
  return {
    modelResponseCount: metrics.modelResponseCount,
    envelopeCount: metrics.modelContextEnvelopeCount,
    embeddedEnvelopeCount: metrics.embeddedModelContextEnvelopeCount,
    boundResponseCount: metrics.modelContextBoundResponseCount,
    unboundResponseCount: metrics.modelContextUnboundResponseCount,
    coverageRate:
      metrics.modelResponseCount === 0
        ? 1
        : metrics.modelContextBoundResponseCount / metrics.modelResponseCount,
  };
}

function payloadString(payload: JsonValue, key: string): string | undefined {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return undefined;
  }
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function payloadNumber(payload: JsonValue, key: string): number | undefined {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return undefined;
  }
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function countEventTypes(events: RunEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  }
  return counts;
}

function toolNames(events: RunEvent[]): Set<string> {
  return new Set(
    events.flatMap((event): string[] => {
      if (event.type !== "tool.started") return [];
      const name = payloadString(event.payload, "toolName");
      return name ? [name] : [];
    }),
  );
}
