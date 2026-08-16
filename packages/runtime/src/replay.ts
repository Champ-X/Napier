import {
  type RunEvent,
  type RunMetrics,
  type RunReplaySnapshot,
  type RunReplaySnapshotVerification,
  type SubagentTask,
  type ThreadReplayBundle,
} from "@napier/contracts";

import type { ReplayStorePort } from "./store-port.js";
import { assertArtifactReceiptEventBoundary } from "./artifact-receipts.js";
import { canonicalJson } from "./ed25519.js";
import { validateModelContextEnvelopeReceipt } from "./model-context-envelope.js";
import { assertModelRequestEvidenceBindings } from "./model-prompt-evidence-bindings.js";
import { assertIndependentModelAdvisorReviewEvidenceBindings } from "./independent-model-advisor.js";
import {
  deriveRunMetrics,
  hashEventStream,
  hashRunReplaySnapshotContent,
  walkEmbeddedModelContextEnvelopes,
} from "./run-replay.js";
import { assertOutcome } from "./run-outcomes.js";
import { assertSubagentOutcomeBinding } from "./subagent-outcomes.js";
import { createThreadReplayBundle as buildThreadReplayBundle } from "./thread-bundles.js";

export {
  aggregateRunUsage,
  compareRuns,
  createRunReplaySnapshot,
  deriveRunMetrics,
  hashEventStream,
} from "./run-replay.js";

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
  const runOutcome = (run as unknown as Record<string, unknown>)["outcome"];
  assertOutcome(runStatus, runOutcome, "Run replay snapshot run");
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
  assertModelRequestEvidenceBindings(events, {
    knownRunIds: new Set([runId]),
    label: "Run replay snapshot",
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
