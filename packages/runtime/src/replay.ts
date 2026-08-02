import { createHash } from "node:crypto";

import {
  emptyUsage,
  traceSummaryBoundaryDelta,
  type JsonValue,
  type RunContextCoverageDelta,
  type RunContextCoverageSummary,
  type RunComparison,
  type RunEvent,
  type RunMetricDelta,
  type RunMetrics,
  type RunReplaySnapshot,
  type RunReplaySnapshotVerification,
  type SubagentTask,
  type ThreadReplayBundle,
  type Usage,
} from "@napier/contracts";

import type { ReplayStorePort } from "./store-port.js";
import { assertArtifactReceiptEventBoundary } from "./artifact-receipts.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { compareRunConfigurations } from "./run-config.js";
import {
  assertModelContextEnvelopeEventBindings,
  MODEL_CONTEXT_ENVELOPE_EVENT,
  validateModelContextEnvelopeReceipt,
} from "./model-context-envelope.js";
import { assertIndependentModelAdvisorReviewEvidenceBindings } from "./independent-model-advisor.js";
import { assertSubagentOutcomeBinding } from "./subagent-outcomes.js";
import { createThreadReplayBundle as buildThreadReplayBundle } from "./thread-bundles.js";

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
const RUN_STATUSES = new Set([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
const EVENT_CATEGORIES = new Set([
  "lifecycle",
  "message",
  "model",
  "tool",
  "artifact",
  "goal",
  "plan",
  "memory",
  "subagent",
  "extension",
  "credential",
  "evaluation",
  "automation",
  "channel",
  "system",
]);
const EVENT_VISIBILITIES = new Set(["user", "debug", "hidden"]);
const SHA256 = /^[a-f0-9]{64}$/;

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

export function verifyRunReplaySnapshot(
  input: unknown,
): RunReplaySnapshotVerification {
  try {
    const snapshot = validateRunReplaySnapshot(input);
    return {
      status: "valid",
      diagnostics: [],
      threadId: snapshot.threadId,
      runId: snapshot.run.id,
      contentSha256: snapshot.contentSha256,
      eventStreamSha256: snapshot.eventStreamSha256,
      ...(snapshot.configurationSha256
        ? { configurationSha256: snapshot.configurationSha256 }
        : {}),
      assistantTextSha256: snapshot.metrics.assistantTextSha256,
      eventCount: snapshot.events.length,
      subagentCount: snapshot.subagents.length,
      modelContextEnvelopeCount: snapshot.metrics.modelContextEnvelopeCount,
      embeddedModelContextEnvelopeCount:
        snapshot.metrics.embeddedModelContextEnvelopeCount,
    };
  } catch (error) {
    return {
      status: "invalid",
      diagnostics: [runReplaySnapshotDiagnostic(error)],
      eventCount: 0,
      subagentCount: 0,
      modelContextEnvelopeCount: 0,
      embeddedModelContextEnvelopeCount: 0,
    };
  }
}

export async function exportThreadReplayBundle(
  store: ReplayStorePort,
  threadId: string,
): Promise<ThreadReplayBundle> {
  const detail = await store.getDetail(threadId);
  return buildThreadReplayBundle(
    detail,
    new Date(),
    store.listAgentRevisions(detail.agent.id),
  );
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

function validateRunReplaySnapshot(input: unknown): RunReplaySnapshot {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    throw new Error("Run replay snapshot must be an object");
  }
  const record = input as Record<string, unknown>;
  const keys = new Set([
    "schemaVersion",
    "generatedAt",
    "threadId",
    "run",
    "metrics",
    "events",
    "subagents",
    "eventStreamSha256",
    "configurationSha256",
    "contentSha256",
  ]);
  for (const key of [
    "schemaVersion",
    "generatedAt",
    "threadId",
    "run",
    "metrics",
    "events",
    "subagents",
    "eventStreamSha256",
    "contentSha256",
  ]) {
    if (!(key in record)) {
      throw new Error(`Run replay snapshot is missing field: ${key}`);
    }
  }
  for (const key of Object.keys(record)) {
    if (!keys.has(key)) {
      throw new Error(`Run replay snapshot has unsupported field: ${key}`);
    }
  }
  if (record["schemaVersion"] !== 1) {
    throw new Error("Run replay snapshot schemaVersion is unsupported");
  }
  if (
    typeof record["generatedAt"] !== "string" ||
    Number.isNaN(Date.parse(record["generatedAt"]))
  ) {
    throw new Error("Run replay snapshot generatedAt is invalid");
  }
  const threadId = stringField(record, "threadId");
  const run = recordField(record, "run") as unknown as RunReplaySnapshot["run"];
  const runId = stringField(run as unknown as Record<string, unknown>, "id");
  if (
    stringField(run as unknown as Record<string, unknown>, "threadId") !==
    threadId
  ) {
    throw new Error("Run replay snapshot run ownership is invalid");
  }
  const runStatus = (run as unknown as Record<string, unknown>)["status"];
  if (typeof runStatus !== "string" || !RUN_STATUSES.has(runStatus)) {
    throw new Error("Run replay snapshot run status is invalid");
  }
  const startedAt = stringField(
    run as unknown as Record<string, unknown>,
    "startedAt",
  );
  if (Number.isNaN(Date.parse(startedAt))) {
    throw new Error("Run replay snapshot run start is invalid");
  }
  const finishedAt = (run as unknown as Record<string, unknown>)["finishedAt"];
  if (
    finishedAt !== undefined &&
    (typeof finishedAt !== "string" || Number.isNaN(Date.parse(finishedAt)))
  ) {
    throw new Error("Run replay snapshot run finish is invalid");
  }
  const events = arrayField(record, "events") as RunEvent[];
  const subagents = arrayField(record, "subagents") as SubagentTask[];
  let previousSeq = 0;
  for (const event of events) {
    assertReplayEvent(event, threadId, runId, previousSeq);
    previousSeq = event.seq;
  }
  assertModelContextEnvelopeEventBindings(events, {
    knownRunIds: new Set([runId]),
    label: "Run replay snapshot Model Context Envelope",
  });
  assertEmbeddedModelContextEnvelopeReceipts({ events, subagents }, "snapshot");
  assertIndependentModelAdvisorReviewEvidenceBindings(
    events,
    "Run replay snapshot",
  );
  for (const task of subagents) {
    assertReplaySubagent(task, threadId, runId);
  }
  const eventStreamSha256 = stringField(record, "eventStreamSha256");
  if (!SHA256.test(eventStreamSha256)) {
    throw new Error("Run replay snapshot event stream hash is invalid");
  }
  if (eventStreamSha256 !== hashEventStream(events)) {
    throw new Error("Run replay snapshot event stream hash mismatch");
  }
  const configurationSha256 = record["configurationSha256"];
  const runConfiguration = (run as unknown as Record<string, unknown>)[
    "configuration"
  ];
  if (runConfiguration && typeof runConfiguration === "object") {
    const expected = (runConfiguration as { contentSha256?: unknown })
      .contentSha256;
    if (
      typeof configurationSha256 !== "string" ||
      configurationSha256 !== expected
    ) {
      throw new Error("Run replay snapshot configuration hash mismatch");
    }
  } else if (configurationSha256 !== undefined) {
    throw new Error("Run replay snapshot configuration hash is invalid");
  }
  const metrics = recordField(record, "metrics") as unknown as RunMetrics;
  const expectedMetrics = deriveRunMetrics(
    startedAt,
    typeof finishedAt === "string" ? finishedAt : undefined,
    events,
    subagents,
  );
  if (canonicalJson(metrics) !== canonicalJson(expectedMetrics)) {
    throw new Error("Run replay snapshot metrics hash mismatch");
  }
  const contentSha256 = stringField(record, "contentSha256");
  if (!SHA256.test(contentSha256)) {
    throw new Error("Run replay snapshot content hash is invalid");
  }
  const snapshot = input as RunReplaySnapshot;
  const computedContentSha256 = hashRunReplaySnapshotContent(
    runReplaySnapshotContent(snapshot),
  );
  if (contentSha256 !== computedContentSha256) {
    throw new Error("Run replay snapshot content hash mismatch");
  }
  return structuredClone(snapshot);
}

function hashRunReplaySnapshotContent(
  content: Omit<RunReplaySnapshot, "generatedAt" | "contentSha256">,
): string {
  return sha256(canonicalJson(content));
}

function runReplaySnapshotContent(
  snapshot: RunReplaySnapshot,
): Omit<RunReplaySnapshot, "generatedAt" | "contentSha256"> {
  return {
    schemaVersion: snapshot.schemaVersion,
    threadId: snapshot.threadId,
    run: snapshot.run,
    metrics: snapshot.metrics,
    events: snapshot.events,
    subagents: snapshot.subagents,
    eventStreamSha256: snapshot.eventStreamSha256,
    ...(snapshot.configurationSha256
      ? { configurationSha256: snapshot.configurationSha256 }
      : {}),
  };
}

function runReplaySnapshotDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("missing field")) return "missing_field";
  if (message.includes("unsupported field")) return "unsupported_field";
  if (message.includes("schemaVersion")) return "unsupported_schema_version";
  if (message.includes("ownership")) return "ownership_mismatch";
  if (message.includes("event stream hash mismatch")) return "hash_mismatch";
  if (message.includes("content hash mismatch")) return "hash_mismatch";
  if (message.includes("metrics hash mismatch")) return "metrics_mismatch";
  if (message.includes("Model Context Envelope")) return "context_mismatch";
  if (message.includes("independent Model Advisor evidence summary")) {
    return "advisor_evidence_mismatch";
  }
  if (message.includes("configuration hash mismatch")) {
    return "configuration_mismatch";
  }
  if (message.includes("invalid")) return "invalid_shape";
  return "invalid_snapshot";
}

function assertReplayEvent(
  event: unknown,
  threadId: string,
  runId: string,
  previousSeq: number,
): asserts event is RunEvent {
  const record = recordField({ event }, "event");
  if (
    typeof record["id"] !== "string" ||
    record["threadId"] !== threadId ||
    record["runId"] !== runId ||
    typeof record["seq"] !== "number" ||
    !Number.isSafeInteger(record["seq"]) ||
    record["seq"] <= previousSeq ||
    typeof record["type"] !== "string" ||
    typeof record["category"] !== "string" ||
    !EVENT_CATEGORIES.has(record["category"]) ||
    typeof record["visibility"] !== "string" ||
    !EVENT_VISIBILITIES.has(record["visibility"]) ||
    typeof record["createdAt"] !== "string" ||
    Number.isNaN(Date.parse(record["createdAt"])) ||
    !Object.prototype.hasOwnProperty.call(record, "payload")
  ) {
    throw new Error("Run replay snapshot event is invalid");
  }
  assertArtifactReceiptEventBoundary(record, "Run replay snapshot event");
}

function assertReplaySubagent(
  task: unknown,
  threadId: string,
  runId: string,
): asserts task is SubagentTask {
  const record = recordField({ task }, "task");
  const usage = record["usage"];
  if (
    typeof record["id"] !== "string" ||
    record["threadId"] !== threadId ||
    record["runId"] !== runId ||
    typeof record["role"] !== "string" ||
    typeof record["prompt"] !== "string" ||
    !usage ||
    Array.isArray(usage) ||
    typeof usage !== "object"
  ) {
    throw new Error("Run replay snapshot subagent is invalid");
  }
  if (record["outcome"] !== undefined) {
    if (record["status"] !== "completed") {
      throw new Error(
        "Run replay snapshot subagent outcome requires completed status",
      );
    }
    assertSubagentOutcomeBinding(record["outcome"], {
      id: record["id"],
      role: record["role"] as SubagentTask["role"],
      model: recordField(record, "model") as unknown as SubagentTask["model"],
      prompt: record["prompt"],
    });
  }
}

function recordField(
  record: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const value = record[field];
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`Run replay snapshot ${field} is invalid`);
  }
  return value as Record<string, unknown>;
}

function arrayField(record: Record<string, unknown>, field: string): unknown[] {
  const value = record[field];
  if (!Array.isArray(value)) {
    throw new Error(`Run replay snapshot ${field} is invalid`);
  }
  return value;
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Run replay snapshot ${field} is invalid`);
  }
  return value;
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

function assertEmbeddedModelContextEnvelopeReceipts(
  value: unknown,
  path: string,
): void {
  walkEmbeddedModelContextEnvelopes(value, path, (envelope, envelopePath) => {
    try {
      validateModelContextEnvelopeReceipt(envelope);
    } catch (error) {
      throw new Error(
        `Run replay snapshot embedded Model Context Envelope is invalid at ${envelopePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });
}

function countEmbeddedModelContextEnvelopes(value: unknown): number {
  let count = 0;
  walkEmbeddedModelContextEnvelopes(value, "snapshot", () => {
    count += 1;
  });
  return count;
}

function walkEmbeddedModelContextEnvelopes(
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
