import { createHash } from "node:crypto";

import {
  NAPIER_API_VERSION,
  type JsonValue,
  type OpenTelemetryTraceArtifact,
  type OpenTelemetryTraceArtifactVerification,
  type OtlpAnyValue,
  type OtlpExportTraceServiceRequest,
  type OtlpKeyValue,
  type OtlpSpan,
  type OtlpSpanEvent,
  type OtlpSpanStatus,
  type RunEvent,
  type RunRecord,
  type SubagentTask,
  type ThreadDetail,
} from "@napier/contracts";

import { hashEventStream } from "./replay.js";
import type { LocalStore } from "./store.js";

export const MAX_OTLP_TRACE_EVENTS = 10_000;
export const MAX_OTLP_TRACE_SPANS = 5_000;
export const MAX_OTLP_TRACE_ARTIFACT_BYTES = 10 * 1024 * 1024;

export const OTEL_SEMCONV_SCHEMA_URL =
  "https://opentelemetry.io/schemas/1.43.0";
export const OTEL_INSTRUMENTATION_SCOPE = "@napier/runtime/opentelemetry";
export const OTEL_INSTRUMENTATION_VERSION = "0.1.0";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TRACE_ID_PATTERN = /^[a-f0-9]{32}$/;
const SPAN_ID_PATTERN = /^[a-f0-9]{16}$/;
const RESOURCE_ID_PATTERN = /^[a-z][a-z0-9_]{2,80}$/;
const ATTRIBUTE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,255}$/;
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_.-]{1,127}$/;

const EXCLUDED_EVENT_TYPES = [
  "model.text.delta",
  "trace.otlp.exported",
] as const;

const EXCLUDED_PAYLOAD_KEYS = [
  "args",
  "content",
  "description",
  "details",
  "error",
  "evidence",
  "input",
  "message",
  "note",
  "objective",
  "output",
  "prompt",
  "reason",
  "reasoning",
  "result",
  "summary",
  "systemPrompt",
  "text",
  "toolCalls",
] as const;

const SAFE_STRING_PAYLOAD_KEYS = new Set([
  "action",
  "actualVerdict",
  "algorithm",
  "availability",
  "consensusVerdict",
  "effect",
  "evidenceState",
  "expectedVerdict",
  "kind",
  "model",
  "modelVerdict",
  "operation",
  "providerId",
  "reviewStatus",
  "role",
  "source",
  "sourceType",
  "status",
  "stopReason",
  "toolName",
  "verdict",
]);

const SAFE_ID_PAYLOAD_KEYS = new Set([
  "adjudicationId",
  "agentId",
  "artifactId",
  "ballotId",
  "baselineId",
  "callId",
  "caseId",
  "casebookId",
  "channelId",
  "checkpointId",
  "credentialId",
  "deliveryId",
  "evaluationId",
  "executionId",
  "extensionId",
  "parentCheckpointId",
  "parentRunId",
  "planId",
  "referenceId",
  "resolutionId",
  "runId",
  "scheduleId",
  "sourceEvaluationId",
  "sourceRunId",
  "stepId",
  "suiteId",
  "taskId",
  "threadId",
  "triggerId",
  "trustAnchorId",
]);

const SAFE_NUMBER_PAYLOAD_KEYS = new Set([
  "actualCostUsd",
  "agreementCount",
  "agreementRate",
  "attempt",
  "attemptCount",
  "averageCandidateScore",
  "branchFromSeq",
  "cacheReadTokens",
  "cacheWriteTokens",
  "caseCount",
  "conclusiveCount",
  "continuation",
  "costUsd",
  "currentRevision",
  "durationMs",
  "editCount",
  "eventCount",
  "exitCode",
  "failedCount",
  "fromSeq",
  "inconclusiveCount",
  "inputTokens",
  "maxAttempts",
  "maxContinuations",
  "messageIndex",
  "minimumAgreementRate",
  "minimumPassRate",
  "observed",
  "outputTokens",
  "passedCount",
  "passRate",
  "retainedFromSeq",
  "retryBaseMs",
  "reviewerCount",
  "revision",
  "sampleCount",
  "sizeBytes",
  "sourceEventCount",
  "spanCount",
  "stepCount",
  "toSeq",
  "turnCount",
  "unverifiedCount",
]);

const SAFE_BOOLEAN_PAYLOAD_KEYS = new Set([
  "agreement",
  "allowInconclusive",
  "compacted",
  "configured",
  "created",
  "duplicate",
  "enabled",
  "networkAllowed",
  "outputCapped",
  "truncated",
  "verified",
]);

const RESOURCE_ATTRIBUTE_KEYS = new Set([
  "service.name",
  "service.namespace",
  "service.version",
  "telemetry.sdk.language",
  "telemetry.sdk.name",
  "telemetry.sdk.version",
]);

const SPAN_ATTRIBUTE_KEYS = new Set([
  "gen_ai.agent.id",
  "gen_ai.agent.name",
  "gen_ai.agent.version",
  "gen_ai.conversation.id",
  "gen_ai.operation.name",
  "gen_ai.provider.name",
  "gen_ai.request.model",
  "gen_ai.tool.name",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
  "napier.agent.id",
  "napier.agent.run.cost_usd",
  "napier.cache.read_tokens",
  "napier.cache.write_tokens",
  "napier.event.count",
  "napier.event_stream.sha256",
  "napier.export.scope",
  "napier.gen_ai.cost_usd",
  "napier.gen_ai.finish_reason",
  "napier.ledger.event_id",
  "napier.ledger.seq",
  "napier.outcome.known",
  "napier.run.configuration.sha256",
  "napier.run.id",
  "napier.run.parent_run_id",
  "napier.run.source",
  "napier.run.status",
  "napier.subagent.status",
  "napier.subagent.step_count",
  "napier.subagent.stop_reason",
  "napier.subagent.turn_count",
  "napier.thread.id",
  "napier.timing.precision",
  "napier.tool.call_id",
  "napier.tool.duration_ms",
  "napier.tool.status",
]);

const BASE_EVENT_ATTRIBUTE_KEYS = new Set([
  "napier.event.category",
  "napier.event.id",
  "napier.event.seq",
  "napier.event.type",
  "napier.event.visibility",
  "napier.event.usage.cache_read_tokens",
  "napier.event.usage.cache_write_tokens",
  "napier.event.usage.cost_usd",
  "napier.event.usage.input_tokens",
  "napier.event.usage.output_tokens",
]);

const SAFE_EVENT_PAYLOAD_ATTRIBUTE_KEYS = new Set(
  [
    ...SAFE_STRING_PAYLOAD_KEYS,
    ...SAFE_ID_PAYLOAD_KEYS,
    ...SAFE_NUMBER_PAYLOAD_KEYS,
    ...SAFE_BOOLEAN_PAYLOAD_KEYS,
  ].map((key) => `napier.event.payload.${camelToSnake(key)}`),
);

interface ToolTrace {
  callId: string;
  toolName: string;
  events: RunEvent[];
  started?: RunEvent;
  terminal?: RunEvent;
}

export async function createOpenTelemetryTraceArtifact(
  store: LocalStore,
  threadId: string,
  runId?: string,
  generatedAt = new Date(),
): Promise<OpenTelemetryTraceArtifact> {
  const detail = await store.getDetail(threadId);
  const selectedRun = runId
    ? detail.runs.find((run) => run.id === runId)
    : undefined;
  if (runId && !selectedRun) {
    throw new Error(`Run not found in thread: ${runId}`);
  }
  const sourceEvents = detail.events.filter(
    (event) =>
      !EXCLUDED_EVENT_TYPES.includes(
        event.type as (typeof EXCLUDED_EVENT_TYPES)[number],
      ) &&
      (!runId || event.runId === runId),
  );
  if (sourceEvents.length > MAX_OTLP_TRACE_EVENTS) {
    throw new Error(
      `OpenTelemetry trace exceeds ${MAX_OTLP_TRACE_EVENTS} source events`,
    );
  }
  const selectedRuns = selectedRun ? [selectedRun] : detail.runs;
  const selectedSubagents = detail.subagents.filter(
    (task) => !runId || task.runId === runId,
  );
  const traceId = deterministicId(`trace:${threadId}`, 32);
  const otlp = buildOtlpRequest(
    detail,
    selectedRuns,
    selectedSubagents,
    sourceEvents,
    traceId,
    runId,
  );
  const spans = otlp.resourceSpans[0]!.scopeSpans[0]!.spans;
  if (spans.length > MAX_OTLP_TRACE_SPANS) {
    throw new Error(
      `OpenTelemetry trace exceeds ${MAX_OTLP_TRACE_SPANS} spans`,
    );
  }
  const content: Omit<
    OpenTelemetryTraceArtifact,
    "generatedAt" | "contentSha256"
  > = {
    kind: "napier.opentelemetry-trace",
    schemaVersion: 1,
    apiVersion: NAPIER_API_VERSION,
    threadId,
    ...(runId ? { runId } : {}),
    traceId,
    eventRange: {
      fromSeq: sourceEvents[0]?.seq ?? 0,
      toSeq: sourceEvents.at(-1)?.seq ?? 0,
      eventCount: sourceEvents.length,
      eventStreamSha256: hashEventStream(sourceEvents),
    },
    spanCount: spans.length,
    redaction: {
      mode: "metadata_only",
      contentCapture: false,
      excludedEventTypes: [...EXCLUDED_EVENT_TYPES],
      excludedPayloadKeys: [...EXCLUDED_PAYLOAD_KEYS],
    },
    otlp,
  };
  const artifact: OpenTelemetryTraceArtifact = {
    ...content,
    generatedAt: generatedAt.toISOString(),
    contentSha256: hashOpenTelemetryTraceArtifact(content),
  };
  if (
    Buffer.byteLength(JSON.stringify(artifact)) > MAX_OTLP_TRACE_ARTIFACT_BYTES
  ) {
    throw new Error(
      `OpenTelemetry trace artifact exceeds ${MAX_OTLP_TRACE_ARTIFACT_BYTES} bytes`,
    );
  }
  return validateOpenTelemetryTraceArtifact(artifact);
}

export function hashOpenTelemetryTraceArtifact(
  artifact: Omit<OpenTelemetryTraceArtifact, "generatedAt" | "contentSha256">,
): string {
  return sha256(canonicalJson(artifact));
}

export function validateOpenTelemetryTraceArtifact(
  value: unknown,
): OpenTelemetryTraceArtifact {
  if (
    !isRecord(value) ||
    Buffer.byteLength(JSON.stringify(value)) > MAX_OTLP_TRACE_ARTIFACT_BYTES
  ) {
    throw new Error("OpenTelemetry trace artifact must be a bounded object");
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "generatedAt",
    "threadId",
    "runId",
    "traceId",
    "eventRange",
    "spanCount",
    "redaction",
    "otlp",
    "contentSha256",
  ]);
  const artifact = value as unknown as OpenTelemetryTraceArtifact;
  if (
    artifact.kind !== "napier.opentelemetry-trace" ||
    artifact.schemaVersion !== 1 ||
    artifact.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(artifact.generatedAt) ||
    !RESOURCE_ID_PATTERN.test(artifact.threadId) ||
    (artifact.runId !== undefined &&
      !RESOURCE_ID_PATTERN.test(artifact.runId)) ||
    !TRACE_ID_PATTERN.test(artifact.traceId) ||
    artifact.traceId === "0".repeat(32) ||
    artifact.traceId !== deterministicId(`trace:${artifact.threadId}`, 32) ||
    !Number.isInteger(artifact.spanCount) ||
    artifact.spanCount < 1 ||
    artifact.spanCount > MAX_OTLP_TRACE_SPANS ||
    !SHA256_PATTERN.test(artifact.contentSha256)
  ) {
    throw new Error("OpenTelemetry trace artifact header is invalid");
  }
  validateEventRange(artifact.eventRange);
  validateRedaction(artifact.redaction);
  const spans = validateOtlpRequest(artifact.otlp, artifact.traceId);
  if (spans.length !== artifact.spanCount) {
    throw new Error("OpenTelemetry trace span count mismatch");
  }
  const root = spans.find((span) => span.parentSpanId === undefined);
  if (
    !root ||
    root.spanId !== deterministicId(`thread:${artifact.threadId}`, 16)
  ) {
    throw new Error("OpenTelemetry trace root span is invalid");
  }
  const {
    generatedAt: _generatedAt,
    contentSha256: _contentSha256,
    ...content
  } = artifact;
  if (hashOpenTelemetryTraceArtifact(content) !== artifact.contentSha256) {
    throw new Error("OpenTelemetry trace artifact hash mismatch");
  }
  return structuredClone(artifact);
}

export function verifyOpenTelemetryTraceArtifact(
  value: unknown,
): OpenTelemetryTraceArtifactVerification {
  try {
    const artifact = validateOpenTelemetryTraceArtifact(value);
    return {
      status: "valid",
      diagnostics: [],
      threadId: artifact.threadId,
      ...(artifact.runId ? { runId: artifact.runId } : {}),
      traceId: artifact.traceId,
      contentSha256: artifact.contentSha256,
      eventStreamSha256: artifact.eventRange.eventStreamSha256,
      spanCount: artifact.spanCount,
      eventCount: artifact.eventRange.eventCount,
    };
  } catch (error) {
    return {
      status: "invalid",
      diagnostics: [openTelemetryTraceArtifactDiagnostic(error)],
      spanCount: 0,
      eventCount: 0,
    };
  }
}

function openTelemetryTraceArtifactDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("bounded object")) return "too_large";
  if (message.includes("unsupported fields")) return "unsupported_field";
  if (message.includes("header is invalid")) return "invalid_header";
  if (message.includes("event range")) return "invalid_event_range";
  if (message.includes("redaction")) return "invalid_redaction";
  if (message.includes("span count")) return "span_count_mismatch";
  if (message.includes("root span")) return "root_span_mismatch";
  if (message.includes("hash mismatch")) return "hash_mismatch";
  if (message.includes("span")) return "invalid_span";
  if (message.includes("attribute")) return "invalid_attribute";
  if (message.includes("invalid")) return "invalid_shape";
  return "invalid_artifact";
}

function buildOtlpRequest(
  detail: ThreadDetail,
  runs: RunRecord[],
  subagents: SubagentTask[],
  events: RunEvent[],
  traceId: string,
  runId: string | undefined,
): OtlpExportTraceServiceRequest {
  const threadSpanId = deterministicId(`thread:${detail.thread.id}`, 16);
  const runIds = new Set(runs.map((run) => run.id));
  const spans: OtlpSpan[] = [];
  const runSpans = new Map<string, OtlpSpan>();
  const sourceStart = earliestTimestamp([
    detail.thread.createdAt,
    ...runs.map((run) => run.startedAt),
    ...events.map((event) => event.createdAt),
  ]);
  const sourceEnd = latestTimestamp([
    sourceStart,
    ...runs.flatMap((run) => [
      run.finishedAt ?? run.interruptedAt ?? run.startedAt,
    ]),
    ...events.map((event) => event.createdAt),
  ]);
  const rootEvents = events
    .filter((event) => !runIds.has(event.runId))
    .map(toOtlpSpanEvent);
  spans.push(
    createSpan({
      traceId,
      spanId: threadSpanId,
      name: runId ? "napier.thread.run_trace" : "napier.thread",
      kind: 1,
      startAt: sourceStart,
      endAt: sourceEnd,
      attributes: attributes({
        "gen_ai.conversation.id": detail.thread.id,
        "napier.agent.id": detail.agent.id,
        "napier.event.count": events.length,
        "napier.event_stream.sha256": hashEventStream(events),
        "napier.export.scope": runId ? "run" : "thread",
        "napier.thread.id": detail.thread.id,
        ...(runId ? { "napier.run.id": runId } : {}),
      }),
      events: rootEvents,
      status: threadStatus(runs),
    }),
  );

  for (const run of runs) {
    const runEvents = events.filter((event) => event.runId === run.id);
    const spanId = deterministicId(`run:${run.id}`, 16);
    const span = createSpan({
      traceId,
      spanId,
      parentSpanId: threadSpanId,
      name: "invoke_agent napier",
      kind: 1,
      startAt: run.startedAt,
      endAt: latestTimestamp([
        run.finishedAt ?? run.interruptedAt ?? run.startedAt,
        ...runEvents.map((event) => event.createdAt),
      ]),
      attributes: attributes({
        "gen_ai.agent.id": run.agentId,
        "gen_ai.agent.version": String(
          run.agentRevision ?? detail.agent.revision,
        ),
        "gen_ai.conversation.id": detail.thread.id,
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.usage.input_tokens": run.usage.inputTokens,
        "gen_ai.usage.output_tokens": run.usage.outputTokens,
        "napier.agent.run.cost_usd": run.usage.costUsd,
        "napier.cache.read_tokens": run.usage.cacheReadTokens,
        "napier.cache.write_tokens": run.usage.cacheWriteTokens,
        "napier.run.id": run.id,
        "napier.run.source": run.source ?? "user",
        "napier.run.status": run.status,
        ...(run.configuration
          ? {
              "napier.run.configuration.sha256":
                run.configuration.contentSha256,
            }
          : {}),
        ...(run.parentRunId
          ? { "napier.run.parent_run_id": run.parentRunId }
          : {}),
      }),
      events: [],
      status: runStatus(run.status),
    });
    spans.push(span);
    runSpans.set(run.id, span);
  }

  const specializedEventIds = new Set<string>();
  for (const run of runs) {
    const parentSpanId = runSpans.get(run.id)!.spanId;
    const runEvents = events.filter((event) => event.runId === run.id);
    for (const event of runEvents.filter(
      (candidate) => candidate.type === "model.response",
    )) {
      specializedEventIds.add(event.id);
      spans.push(modelSpan(event, traceId, parentSpanId, detail.thread.id));
    }
    for (const tool of collectToolTraces(runEvents)) {
      tool.events.forEach((event) => specializedEventIds.add(event.id));
      spans.push(
        toolSpan(tool, traceId, parentSpanId, detail.thread.id, run, runEvents),
      );
    }
  }

  for (const task of subagents) {
    const parentSpan = runSpans.get(task.runId);
    if (!parentSpan) continue;
    const taskEvents = events.filter(
      (event) =>
        event.category === "subagent" &&
        payloadString(event.payload, "taskId") === task.id,
    );
    taskEvents.forEach((event) => specializedEventIds.add(event.id));
    spans.push(
      subagentSpan(
        task,
        taskEvents,
        traceId,
        parentSpan.spanId,
        detail.thread.id,
      ),
    );
  }

  for (const run of runs) {
    const span = runSpans.get(run.id)!;
    span.events = events
      .filter(
        (event) => event.runId === run.id && !specializedEventIds.has(event.id),
      )
      .map(toOtlpSpanEvent);
  }

  spans.sort((left, right) => {
    if (left.parentSpanId === undefined) return -1;
    if (right.parentSpanId === undefined) return 1;
    return BigInt(left.startTimeUnixNano) < BigInt(right.startTimeUnixNano)
      ? -1
      : BigInt(left.startTimeUnixNano) > BigInt(right.startTimeUnixNano)
        ? 1
        : left.spanId.localeCompare(right.spanId);
  });

  return {
    resourceSpans: [
      {
        resource: {
          attributes: attributes({
            "service.name": "napier",
            "service.namespace": "agent-work-ledger",
            "service.version": OTEL_INSTRUMENTATION_VERSION,
            "telemetry.sdk.language": "nodejs",
            "telemetry.sdk.name": "napier-native-otlp",
            "telemetry.sdk.version": OTEL_INSTRUMENTATION_VERSION,
          }),
          droppedAttributesCount: 0,
        },
        scopeSpans: [
          {
            scope: {
              name: OTEL_INSTRUMENTATION_SCOPE,
              version: OTEL_INSTRUMENTATION_VERSION,
            },
            spans,
            schemaUrl: OTEL_SEMCONV_SCHEMA_URL,
          },
        ],
        schemaUrl: OTEL_SEMCONV_SCHEMA_URL,
      },
    ],
  };
}

function modelSpan(
  event: RunEvent,
  traceId: string,
  parentSpanId: string,
  threadId: string,
): OtlpSpan {
  const model = payloadString(event.payload, "model") ?? "unknown/unknown";
  const separator = model.indexOf("/");
  const provider = separator > 0 ? model.slice(0, separator) : "unknown";
  const modelId = separator > 0 ? model.slice(separator + 1) : model;
  const usage = payloadRecord(event.payload, "usage");
  const stopReason = payloadString(event.payload, "stopReason");
  return createSpan({
    traceId,
    spanId: deterministicId(`model:${event.id}`, 16),
    parentSpanId,
    name: `chat ${boundedName(modelId)}`,
    kind: 3,
    startAt: event.createdAt,
    endAt: event.createdAt,
    attributes: attributes({
      "gen_ai.conversation.id": threadId,
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": provider,
      "gen_ai.request.model": modelId,
      "gen_ai.usage.input_tokens": recordNumber(usage, "inputTokens") ?? 0,
      "gen_ai.usage.output_tokens": recordNumber(usage, "outputTokens") ?? 0,
      "napier.cache.read_tokens": recordNumber(usage, "cacheReadTokens") ?? 0,
      "napier.cache.write_tokens": recordNumber(usage, "cacheWriteTokens") ?? 0,
      "napier.gen_ai.cost_usd": recordNumber(usage, "costUsd") ?? 0,
      "napier.ledger.event_id": event.id,
      "napier.ledger.seq": event.seq,
      "napier.timing.precision": "completion_only",
      ...(stopReason ? { "napier.gen_ai.finish_reason": stopReason } : {}),
    }),
    events: [],
    status:
      stopReason === "error"
        ? { code: 2 }
        : stopReason
          ? { code: 1 }
          : { code: 0 },
  });
}

function collectToolTraces(events: RunEvent[]): ToolTrace[] {
  const traces = new Map<string, ToolTrace>();
  for (const event of events.filter(
    (candidate) => candidate.category === "tool",
  )) {
    const callId = payloadString(event.payload, "callId") ?? event.id;
    const key = `${event.runId}:${callId}`;
    const existing = traces.get(key) ?? {
      callId,
      toolName: payloadString(event.payload, "toolName") ?? "unknown",
      events: [],
    };
    existing.events.push(event);
    if (event.type === "tool.started" && !existing.started) {
      existing.started = event;
    }
    if (
      (event.type === "tool.completed" ||
        event.type === "tool.failed" ||
        event.type === "tool.blocked") &&
      !existing.terminal
    ) {
      existing.terminal = event;
    }
    traces.set(key, existing);
  }
  return [...traces.values()].sort((left, right) => {
    const leftSeq = left.events[0]?.seq ?? 0;
    const rightSeq = right.events[0]?.seq ?? 0;
    return leftSeq - rightSeq;
  });
}

function toolSpan(
  tool: ToolTrace,
  traceId: string,
  parentSpanId: string,
  threadId: string,
  run: RunRecord,
  runEvents: RunEvent[],
): OtlpSpan {
  const first = tool.started ?? tool.events[0]!;
  const terminal = tool.terminal;
  const endAt =
    terminal?.createdAt ??
    run.finishedAt ??
    run.interruptedAt ??
    runEvents.at(-1)?.createdAt ??
    first.createdAt;
  const outcome =
    terminal?.type === "tool.completed"
      ? "completed"
      : terminal?.type === "tool.failed"
        ? "failed"
        : terminal?.type === "tool.blocked"
          ? "blocked"
          : "unknown";
  const durationMs = Math.max(
    0,
    Date.parse(endAt) - Date.parse(first.createdAt),
  );
  return createSpan({
    traceId,
    spanId: deterministicId(`tool:${run.id}:${tool.callId}:${first.id}`, 16),
    parentSpanId,
    name: `execute_tool ${boundedName(tool.toolName)}`,
    kind: 1,
    startAt: first.createdAt,
    endAt,
    attributes: attributes({
      "gen_ai.conversation.id": threadId,
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": tool.toolName,
      "napier.outcome.known": Boolean(terminal),
      "napier.run.id": run.id,
      "napier.tool.call_id": tool.callId,
      "napier.tool.duration_ms": durationMs,
      "napier.tool.status": outcome,
    }),
    events: tool.events.map(toOtlpSpanEvent),
    status:
      outcome === "completed"
        ? { code: 1 }
        : outcome === "unknown"
          ? { code: 0 }
          : { code: 2 },
  });
}

function subagentSpan(
  task: SubagentTask,
  taskEvents: RunEvent[],
  traceId: string,
  parentSpanId: string,
  threadId: string,
): OtlpSpan {
  const startAt = task.startedAt ?? task.createdAt;
  const endAt = task.finishedAt ?? taskEvents.at(-1)?.createdAt ?? startAt;
  return createSpan({
    traceId,
    spanId: deterministicId(`subagent:${task.id}`, 16),
    parentSpanId,
    name: `invoke_agent ${task.role}`,
    kind: 1,
    startAt,
    endAt,
    attributes: attributes({
      "gen_ai.agent.id": task.id,
      "gen_ai.agent.name": task.role,
      "gen_ai.conversation.id": threadId,
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.provider.name": task.model.provider,
      "gen_ai.request.model": task.model.id,
      "gen_ai.usage.input_tokens": task.usage.inputTokens,
      "gen_ai.usage.output_tokens": task.usage.outputTokens,
      "napier.agent.run.cost_usd": task.usage.costUsd,
      "napier.cache.read_tokens": task.usage.cacheReadTokens,
      "napier.cache.write_tokens": task.usage.cacheWriteTokens,
      "napier.subagent.status": task.status,
      "napier.subagent.step_count": task.stepCount,
      "napier.subagent.turn_count": task.turnCount,
      ...(task.stopReason
        ? { "napier.subagent.stop_reason": task.stopReason }
        : {}),
    }),
    events: taskEvents.map(toOtlpSpanEvent),
    status: subagentStatus(task.status),
  });
}

function createSpan(input: {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: 1 | 3;
  startAt: string;
  endAt: string;
  attributes: OtlpKeyValue[];
  events: OtlpSpanEvent[];
  status: OtlpSpanStatus;
}): OtlpSpan {
  const startTimeUnixNano = timestampNanos(input.startAt);
  const endTimeUnixNano = timestampNanos(input.endAt);
  return {
    traceId: input.traceId,
    spanId: input.spanId,
    ...(input.parentSpanId ? { parentSpanId: input.parentSpanId } : {}),
    traceState: "",
    name: boundedName(input.name),
    kind: input.kind,
    startTimeUnixNano,
    endTimeUnixNano:
      BigInt(endTimeUnixNano) >= BigInt(startTimeUnixNano)
        ? endTimeUnixNano
        : startTimeUnixNano,
    attributes: input.attributes,
    droppedAttributesCount: 0,
    events: input.events,
    droppedEventsCount: 0,
    links: [],
    droppedLinksCount: 0,
    status: input.status,
    flags: 1,
  };
}

function toOtlpSpanEvent(event: RunEvent): OtlpSpanEvent {
  const { values, dropped } = safePayloadAttributes(event.payload);
  return {
    timeUnixNano: timestampNanos(event.createdAt),
    name: EVENT_NAME_PATTERN.test(event.type) ? event.type : "napier.event",
    attributes: attributes({
      "napier.event.category": event.category,
      "napier.event.id": event.id,
      "napier.event.seq": event.seq,
      "napier.event.type": event.type,
      "napier.event.visibility": event.visibility,
      ...values,
    }),
    droppedAttributesCount: dropped,
  };
}

function safePayloadAttributes(payload: JsonValue): {
  values: Record<string, string | number | boolean>;
  dropped: number;
} {
  if (!isRecord(payload)) return { values: {}, dropped: 0 };
  const values: Record<string, string | number | boolean> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(payload)) {
    if (
      EXCLUDED_PAYLOAD_KEYS.includes(
        key as (typeof EXCLUDED_PAYLOAD_KEYS)[number],
      )
    ) {
      dropped += 1;
      continue;
    }
    if (key === "usage" && isRecord(value)) {
      for (const usageKey of [
        "inputTokens",
        "outputTokens",
        "cacheReadTokens",
        "cacheWriteTokens",
        "costUsd",
      ]) {
        const usageValue = value[usageKey];
        if (typeof usageValue === "number" && Number.isFinite(usageValue)) {
          values[`napier.event.usage.${camelToSnake(usageKey)}`] = usageValue;
        }
      }
      continue;
    }
    const normalizedKey = `napier.event.payload.${camelToSnake(key)}`;
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      SAFE_NUMBER_PAYLOAD_KEYS.has(key)
    ) {
      values[normalizedKey] = value;
      continue;
    }
    if (typeof value === "boolean" && SAFE_BOOLEAN_PAYLOAD_KEYS.has(key)) {
      values[normalizedKey] = value;
      continue;
    }
    if (
      typeof value === "string" &&
      (SAFE_STRING_PAYLOAD_KEYS.has(key) ||
        SAFE_ID_PAYLOAD_KEYS.has(key) ||
        (key.endsWith("Sha256") && SHA256_PATTERN.test(value)) ||
        (key.endsWith("Fingerprint") && /^[A-Za-z0-9_-]{4,128}$/.test(value)))
    ) {
      values[normalizedKey] = value.slice(0, 512);
      continue;
    }
    dropped += 1;
  }
  return { values, dropped };
}

function attributes(
  input: Record<string, string | number | boolean>,
): OtlpKeyValue[] {
  return Object.entries(input)
    .filter(
      ([key, value]) =>
        ATTRIBUTE_KEY_PATTERN.test(key) &&
        ((typeof value === "number" && Number.isFinite(value)) ||
          typeof value === "string" ||
          typeof value === "boolean"),
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      key,
      value: otlpValue(value),
    }));
}

function otlpValue(value: string | number | boolean): OtlpAnyValue {
  if (typeof value === "string") {
    return { stringValue: value.slice(0, 4_096) };
  }
  if (typeof value === "boolean") return { boolValue: value };
  return Number.isInteger(value)
    ? { intValue: String(value) }
    : { doubleValue: value };
}

function threadStatus(runs: RunRecord[]): OtlpSpanStatus {
  if (
    runs.some((run) =>
      ["failed", "cancelled", "interrupted"].includes(run.status),
    )
  ) {
    return { code: 2 };
  }
  return runs.every((run) => run.status === "completed")
    ? { code: 1 }
    : { code: 0 };
}

function runStatus(status: RunRecord["status"]): OtlpSpanStatus {
  if (status === "completed") return { code: 1 };
  if (status === "queued" || status === "running") return { code: 0 };
  return { code: 2 };
}

function subagentStatus(status: SubagentTask["status"]): OtlpSpanStatus {
  if (status === "completed") return { code: 1 };
  if (status === "pending" || status === "running") return { code: 0 };
  return { code: 2 };
}

function validateEventRange(
  value: OpenTelemetryTraceArtifact["eventRange"],
): void {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.fromSeq) ||
    value.fromSeq < 0 ||
    !Number.isInteger(value.toSeq) ||
    value.toSeq < 0 ||
    !Number.isInteger(value.eventCount) ||
    value.eventCount < 0 ||
    value.eventCount > MAX_OTLP_TRACE_EVENTS ||
    !SHA256_PATTERN.test(value.eventStreamSha256) ||
    (value.eventCount === 0
      ? value.fromSeq !== 0 || value.toSeq !== 0
      : value.fromSeq < 1 ||
        value.toSeq < value.fromSeq ||
        value.eventCount > value.toSeq - value.fromSeq + 1)
  ) {
    throw new Error("OpenTelemetry trace event range is invalid");
  }
}

function validateRedaction(
  value: OpenTelemetryTraceArtifact["redaction"],
): void {
  if (
    !isRecord(value) ||
    value.mode !== "metadata_only" ||
    value.contentCapture !== false ||
    JSON.stringify(value.excludedEventTypes) !==
      JSON.stringify(EXCLUDED_EVENT_TYPES) ||
    JSON.stringify(value.excludedPayloadKeys) !==
      JSON.stringify(EXCLUDED_PAYLOAD_KEYS)
  ) {
    throw new Error("OpenTelemetry trace redaction policy is invalid");
  }
}

function validateOtlpRequest(value: unknown, traceId: string): OtlpSpan[] {
  if (!isRecord(value)) {
    throw new Error("OTLP trace request must be an object");
  }
  assertAllowedKeys(value, ["resourceSpans"]);
  const resourceSpans = value["resourceSpans"];
  if (!Array.isArray(resourceSpans) || resourceSpans.length !== 1) {
    throw new Error("OTLP trace must contain one resource");
  }
  const resourceSpan = resourceSpans[0];
  if (!isRecord(resourceSpan)) {
    throw new Error("OTLP resource span is invalid");
  }
  assertAllowedKeys(resourceSpan, ["resource", "scopeSpans", "schemaUrl"]);
  if (resourceSpan["schemaUrl"] !== OTEL_SEMCONV_SCHEMA_URL) {
    throw new Error("OTLP resource schema URL is invalid");
  }
  validateResource(resourceSpan["resource"]);
  const scopeSpans = resourceSpan["scopeSpans"];
  if (!Array.isArray(scopeSpans) || scopeSpans.length !== 1) {
    throw new Error("OTLP trace must contain one instrumentation scope");
  }
  const scopeSpan = scopeSpans[0];
  if (!isRecord(scopeSpan)) {
    throw new Error("OTLP scope span is invalid");
  }
  assertAllowedKeys(scopeSpan, ["scope", "spans", "schemaUrl"]);
  if (scopeSpan["schemaUrl"] !== OTEL_SEMCONV_SCHEMA_URL) {
    throw new Error("OTLP scope schema URL is invalid");
  }
  const scope = scopeSpan["scope"];
  if (
    !isRecord(scope) ||
    Object.keys(scope).some((key) => key !== "name" && key !== "version") ||
    scope["name"] !== OTEL_INSTRUMENTATION_SCOPE ||
    scope["version"] !== OTEL_INSTRUMENTATION_VERSION
  ) {
    throw new Error("OTLP instrumentation scope is invalid");
  }
  const spans = scopeSpan["spans"];
  if (
    !Array.isArray(spans) ||
    spans.length < 1 ||
    spans.length > MAX_OTLP_TRACE_SPANS
  ) {
    throw new Error("OTLP spans are invalid");
  }
  const typedSpans = spans.map((span) => validateSpan(span, traceId));
  validateSpanGraph(typedSpans);
  return typedSpans;
}

function validateResource(value: unknown): void {
  if (!isRecord(value)) throw new Error("OTLP resource is invalid");
  assertAllowedKeys(value, ["attributes", "droppedAttributesCount"]);
  if (value["droppedAttributesCount"] !== 0) {
    throw new Error("OTLP resource dropped-attribute count is invalid");
  }
  const attributes = validateAttributes(value["attributes"], (key) =>
    RESOURCE_ATTRIBUTE_KEYS.has(key),
  );
  if (
    !attributes.some(
      (attribute) =>
        attribute.key === "service.name" &&
        "stringValue" in attribute.value &&
        attribute.value.stringValue === "napier",
    )
  ) {
    throw new Error("OTLP resource service name is missing");
  }
}

function validateSpan(value: unknown, traceId: string): OtlpSpan {
  if (!isRecord(value)) throw new Error("OTLP span must be an object");
  assertAllowedKeys(value, [
    "traceId",
    "spanId",
    "parentSpanId",
    "traceState",
    "name",
    "kind",
    "startTimeUnixNano",
    "endTimeUnixNano",
    "attributes",
    "droppedAttributesCount",
    "events",
    "droppedEventsCount",
    "links",
    "droppedLinksCount",
    "status",
    "flags",
  ]);
  const span = value as unknown as OtlpSpan;
  if (
    span.traceId !== traceId ||
    !TRACE_ID_PATTERN.test(span.traceId) ||
    !SPAN_ID_PATTERN.test(span.spanId) ||
    span.spanId === "0".repeat(16) ||
    (span.parentSpanId !== undefined &&
      (!SPAN_ID_PATTERN.test(span.parentSpanId) ||
        span.parentSpanId === "0".repeat(16))) ||
    span.traceState !== "" ||
    typeof span.name !== "string" ||
    !span.name ||
    span.name.length > 255 ||
    (span.kind !== 1 && span.kind !== 3) ||
    !/^\d+$/.test(span.startTimeUnixNano) ||
    !/^\d+$/.test(span.endTimeUnixNano) ||
    BigInt(span.endTimeUnixNano) < BigInt(span.startTimeUnixNano) ||
    span.droppedAttributesCount !== 0 ||
    span.droppedEventsCount !== 0 ||
    !Array.isArray(span.links) ||
    span.links.length !== 0 ||
    span.droppedLinksCount !== 0 ||
    span.flags !== 1
  ) {
    throw new Error("OTLP span evidence is invalid");
  }
  validateAttributes(span.attributes, (key) => SPAN_ATTRIBUTE_KEYS.has(key));
  if (!Array.isArray(span.events)) {
    throw new Error("OTLP span events are invalid");
  }
  span.events.forEach((event) => {
    validateSpanEvent(event);
    if (
      BigInt(event.timeUnixNano) < BigInt(span.startTimeUnixNano) ||
      BigInt(event.timeUnixNano) > BigInt(span.endTimeUnixNano)
    ) {
      throw new Error("OTLP span event is outside its span interval");
    }
  });
  validateStatus(span.status);
  return structuredClone(span);
}

function validateSpanEvent(value: unknown): void {
  if (!isRecord(value)) throw new Error("OTLP span event is invalid");
  assertAllowedKeys(value, [
    "timeUnixNano",
    "name",
    "attributes",
    "droppedAttributesCount",
  ]);
  if (
    typeof value["timeUnixNano"] !== "string" ||
    !/^\d+$/.test(value["timeUnixNano"]) ||
    typeof value["name"] !== "string" ||
    !EVENT_NAME_PATTERN.test(value["name"]) ||
    !Number.isInteger(value["droppedAttributesCount"]) ||
    Number(value["droppedAttributesCount"]) < 0
  ) {
    throw new Error("OTLP span event evidence is invalid");
  }
  const attributes = validateAttributes(
    value["attributes"],
    isAllowedEventAttributeKey,
  );
  for (const attribute of attributes) {
    if (
      attribute.key.endsWith("_sha256") &&
      (!("stringValue" in attribute.value) ||
        !SHA256_PATTERN.test(attribute.value.stringValue))
    ) {
      throw new Error("OTLP event SHA-256 attribute is invalid");
    }
    if (
      attribute.key.endsWith("_fingerprint") &&
      (!("stringValue" in attribute.value) ||
        !/^[A-Za-z0-9_-]{4,128}$/.test(attribute.value.stringValue))
    ) {
      throw new Error("OTLP event fingerprint attribute is invalid");
    }
  }
}

function isAllowedEventAttributeKey(key: string): boolean {
  return (
    BASE_EVENT_ATTRIBUTE_KEYS.has(key) ||
    SAFE_EVENT_PAYLOAD_ATTRIBUTE_KEYS.has(key) ||
    /^napier\.event\.payload\.[a-z0-9_.-]+_(sha256|fingerprint)$/.test(key)
  );
}

function validateAttributes(
  value: unknown,
  allowedKey?: (key: string) => boolean,
): OtlpKeyValue[] {
  if (!Array.isArray(value)) {
    throw new Error("OTLP attributes must be an array");
  }
  const keys = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("OTLP attribute is invalid");
    assertAllowedKeys(item, ["key", "value"]);
    const key = item["key"];
    if (
      typeof key !== "string" ||
      !ATTRIBUTE_KEY_PATTERN.test(key) ||
      (allowedKey !== undefined && !allowedKey(key)) ||
      keys.has(key)
    ) {
      throw new Error("OTLP attribute key is invalid");
    }
    keys.add(key);
    validateAnyValue(item["value"]);
    return structuredClone(item) as unknown as OtlpKeyValue;
  });
}

function validateAnyValue(value: unknown): void {
  if (!isRecord(value) || Object.keys(value).length !== 1) {
    throw new Error("OTLP attribute value is invalid");
  }
  if (
    "stringValue" in value &&
    typeof value["stringValue"] === "string" &&
    value["stringValue"].length <= 4_096
  ) {
    return;
  }
  if ("boolValue" in value && typeof value["boolValue"] === "boolean") return;
  if (
    "intValue" in value &&
    typeof value["intValue"] === "string" &&
    /^-?\d+$/.test(value["intValue"])
  ) {
    return;
  }
  if (
    "doubleValue" in value &&
    typeof value["doubleValue"] === "number" &&
    Number.isFinite(value["doubleValue"])
  ) {
    return;
  }
  throw new Error("OTLP attribute value type is invalid");
}

function validateStatus(value: unknown): void {
  if (!isRecord(value)) throw new Error("OTLP span status is invalid");
  assertAllowedKeys(value, ["code", "message"]);
  if (
    (value["code"] !== 0 && value["code"] !== 1 && value["code"] !== 2) ||
    (value["message"] !== undefined &&
      (typeof value["message"] !== "string" || value["message"].length > 256))
  ) {
    throw new Error("OTLP span status evidence is invalid");
  }
}

function validateSpanGraph(spans: OtlpSpan[]): void {
  const ids = new Set<string>();
  for (const span of spans) {
    if (ids.has(span.spanId)) throw new Error("Duplicate OTLP span ID");
    ids.add(span.spanId);
  }
  const roots = spans.filter((span) => span.parentSpanId === undefined);
  if (roots.length !== 1) throw new Error("OTLP trace must have one root span");
  for (const span of spans) {
    if (span.parentSpanId && !ids.has(span.parentSpanId)) {
      throw new Error("OTLP span parent is missing");
    }
    const parent = span.parentSpanId
      ? spans.find((candidate) => candidate.spanId === span.parentSpanId)
      : undefined;
    if (
      parent &&
      (BigInt(span.startTimeUnixNano) < BigInt(parent.startTimeUnixNano) ||
        BigInt(span.endTimeUnixNano) > BigInt(parent.endTimeUnixNano))
    ) {
      throw new Error("OTLP child span is outside its parent interval");
    }
    let cursor: OtlpSpan | undefined = span;
    const visited = new Set<string>();
    while (cursor?.parentSpanId) {
      if (visited.has(cursor.spanId)) {
        throw new Error("OTLP span graph contains a cycle");
      }
      visited.add(cursor.spanId);
      cursor = spans.find(
        (candidate) => candidate.spanId === cursor?.parentSpanId,
      );
    }
  }
}

function payloadString(payload: JsonValue, key: string): string | undefined {
  if (!isRecord(payload)) return undefined;
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function payloadRecord(
  payload: JsonValue,
  key: string,
): Record<string, JsonValue> | undefined {
  if (!isRecord(payload)) return undefined;
  const value = payload[key];
  return isRecord(value) ? value : undefined;
}

function recordNumber(
  record: Record<string, JsonValue> | undefined,
  key: string,
): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function deterministicId(input: string, length: 16 | 32): string {
  const value = sha256(`napier.opentelemetry.v1:${input}`).slice(0, length);
  return value === "0".repeat(length) ? `${"0".repeat(length - 1)}1` : value;
}

function timestampNanos(value: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`OpenTelemetry timestamp is invalid: ${value}`);
  }
  return (BigInt(milliseconds) * 1_000_000n).toString();
}

function earliestTimestamp(values: string[]): string {
  return values.reduce((earliest, value) =>
    Date.parse(value) < Date.parse(earliest) ? value : earliest,
  );
}

function latestTimestamp(values: string[]): string {
  return values.reduce((latest, value) =>
    Date.parse(value) > Date.parse(latest) ? value : latest,
  );
}

function boundedName(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return (normalized || "unknown").slice(0, 255);
}

function camelToSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .toLowerCase();
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error("OpenTelemetry evidence contains unsupported fields");
  }
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
