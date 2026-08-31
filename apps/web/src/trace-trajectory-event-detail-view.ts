import type { RunEvent } from "@napier/contracts";

import { messageEventTraceView } from "./message-event-view";
import { modelEventTraceView } from "./model-event-view";
import { modelResponseTraceView } from "./model-response-view";
import { modelRouteEventTraceView } from "./model-route-event-view";
import { toolEventTraceView } from "./tool-event-view";
import {
  traceTrajectoryEventKeyPath,
  traceTrajectoryModelUsageEvidence,
  traceTrajectoryRequestMetrics,
  traceTrajectoryTimingFields,
} from "./trace-trajectory-event-performance";
import type { TraceTrajectoryEvent } from "./trace-trajectory-model";

export interface TraceTrajectoryDetailField {
  key: string;
  value: string;
  digest?: boolean;
}

export interface TraceTrajectoryEventDetailView {
  keyPath: string;
  metrics: TraceTrajectoryDetailField[];
  context: TraceTrajectoryDetailField[];
  diagnosis?: TraceTrajectoryDiagnosis;
  evidence: TraceTrajectoryDetailField[];
  timing: TraceTrajectoryDetailField[];
}

export type TraceTrajectoryFailureCategory =
  | "timeout"
  | "output_limit"
  | "policy_block"
  | "model_route_failure"
  | "run_failure"
  | "tool_failure"
  | "execution_failure";

export interface TraceTrajectoryRelatedEvent {
  eventId: string;
  label: string;
  relation: "started" | "failed" | "retry" | "fallback";
  sequence: number;
}

export interface TraceTrajectoryDiagnosis {
  category: TraceTrajectoryFailureCategory;
  subject?: string;
  input: TraceTrajectoryDetailField[];
  outcome: TraceTrajectoryDetailField[];
  parent: TraceTrajectoryDetailField[];
  related: TraceTrajectoryRelatedEvent[];
}

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:/@-]{1,180}$/u;
const GENERIC_DIGEST_FIELDS = [
  "callInputSha256",
  "inputSha256",
  "outputTextSha256",
  "outputSha256",
  "resultSha256",
  "contentSha256",
] as const;
const GENERIC_COUNT_FIELDS = [
  "inputBytes",
  "outputTextBytes",
  "outputBytes",
] as const;

export function traceTrajectoryEventDetailView(
  event: TraceTrajectoryEvent,
  events: readonly TraceTrajectoryEvent[] = [event],
): TraceTrajectoryEventDetailView {
  const evidence = evidenceFields(event.event);
  return {
    keyPath: traceTrajectoryEventKeyPath(event, evidence),
    metrics: traceTrajectoryRequestMetrics(event, events, evidence),
    context: contextFields(event),
    ...(event.status === "failed"
      ? { diagnosis: diagnosisView(event, events) }
      : {}),
    evidence,
    timing: traceTrajectoryTimingFields(event, events),
  };
}

function diagnosisView(
  event: TraceTrajectoryEvent,
  events: readonly TraceTrajectoryEvent[],
): TraceTrajectoryDiagnosis {
  const payload = record(event.event.payload);
  const projection = dedicatedEvidenceProjection(event.event);
  const evidence = record(projection);
  const callKey = traceCallKey(event.event);
  const started = callKey
    ? events.find(
        (candidate) =>
          candidate.event.seq < event.event.seq &&
          traceCallKey(candidate.event) === callKey &&
          candidate.event.type.endsWith("started"),
      )
    : undefined;
  const startPayload = record(started?.event.payload);
  const startEvidence = started
    ? record(dedicatedEvidenceProjection(started.event))
    : undefined;
  const subject =
    safeToken(payload?.["toolName"]) ??
    safeToken(evidence?.["servingModel"]) ??
    safeToken(evidence?.["model"]);
  return {
    category: failureCategory(event, evidence),
    ...(subject ? { subject } : {}),
    input: diagnosticInput(payload, startPayload, evidence, startEvidence),
    outcome: diagnosticOutcome(payload, evidence),
    parent: diagnosticParent(payload, startPayload),
    related: relatedEvents(event, events, callKey, subject),
  };
}

function failureCategory(
  event: TraceTrajectoryEvent,
  evidence: Record<string, unknown> | undefined,
): TraceTrajectoryFailureCategory {
  const commandStatus = safeToken(evidence?.["commandStatus"]);
  if (commandStatus === "timed_out") return "timeout";
  if (commandStatus === "output_capped") return "output_limit";
  if (event.event.type.includes("blocked")) return "policy_block";
  if (event.event.type.startsWith("route_")) return "model_route_failure";
  if (event.event.type === "run.failed") return "run_failure";
  if (event.event.type === "tool.failed") return "tool_failure";
  return "execution_failure";
}

function diagnosticInput(
  payload: Record<string, unknown> | undefined,
  startPayload: Record<string, unknown> | undefined,
  evidence: Record<string, unknown> | undefined,
  startEvidence: Record<string, unknown> | undefined,
): TraceTrajectoryDetailField[] {
  const digest =
    sha256(payload?.["callInputSha256"]) ??
    sha256(payload?.["inputSha256"]) ??
    sha256(startPayload?.["callInputSha256"]) ??
    sha256(startPayload?.["inputSha256"]);
  const argumentCount =
    nonNegativeNumber(evidence?.["commandArgumentCount"]) ??
    nonNegativeNumber(startEvidence?.["commandArgumentCount"]);
  return [
    ...(digest ? [field("inputSha256", shortDigest(digest), true)] : []),
    ...(argumentCount !== undefined
      ? [field("argumentCount", String(argumentCount))]
      : []),
  ];
}

function diagnosticOutcome(
  payload: Record<string, unknown> | undefined,
  evidence: Record<string, unknown> | undefined,
): TraceTrajectoryDetailField[] {
  const exitCode = finiteNumber(evidence?.["commandExitCode"]);
  const outputBytes =
    nonNegativeNumber(payload?.["outputTextBytes"]) ??
    nonNegativeNumber(payload?.["outputBytes"]);
  const outputDigest =
    sha256(payload?.["outputTextSha256"]) ?? sha256(payload?.["outputSha256"]);
  const errorDigest = sha256(payload?.["errorSha256"]);
  const truncated =
    evidence?.["commandStdoutTruncated"] === true ||
    evidence?.["commandStderrTruncated"] === true ||
    evidence?.["nodeDebuggerOutputTruncated"] === true;
  return [
    ...(exitCode !== undefined ? [field("exitCode", String(exitCode))] : []),
    ...(outputBytes !== undefined
      ? [field("outputBytes", String(outputBytes))]
      : []),
    ...(outputDigest
      ? [field("outputSha256", shortDigest(outputDigest), true)]
      : []),
    ...(errorDigest
      ? [field("errorSha256", shortDigest(errorDigest), true)]
      : []),
    ...(truncated ? [field("outputTruncated", "true")] : []),
  ];
}

function diagnosticParent(
  payload: Record<string, unknown> | undefined,
  startPayload: Record<string, unknown> | undefined,
): TraceTrajectoryDetailField[] {
  const source = { ...startPayload, ...payload };
  return [
    ["parentEvaluationId", "codeBridge"],
    ["workflowId", "workflow"],
    ["workflowRunId", "workflowRun"],
    ["taskId", "subagent"],
    ["modelCallId", "modelCall"],
  ].flatMap(([key, label]) => {
    const value = safeToken(source[key!]);
    return value ? [field(label!, shortIdentifier(value))] : [];
  });
}

function relatedEvents(
  event: TraceTrajectoryEvent,
  events: readonly TraceTrajectoryEvent[],
  callKey: string | undefined,
  subject: string | undefined,
): TraceTrajectoryRelatedEvent[] {
  const output: TraceTrajectoryRelatedEvent[] = [];
  if (callKey) {
    const start = [...events]
      .reverse()
      .find(
        (candidate) =>
          candidate.event.seq < event.event.seq &&
          traceCallKey(candidate.event) === callKey &&
          candidate.event.type.endsWith("started"),
      );
    if (start) output.push(related(start, "started"));
  }
  output.push(related(event, "failed"));
  const later = events.filter(
    (candidate) =>
      candidate.event.runId === event.event.runId &&
      candidate.event.seq > event.event.seq,
  );
  const retry = later.find(
    (candidate) =>
      candidate.event.type === "tool.started" &&
      subject !== undefined &&
      safeToken(record(candidate.event.payload)?.["toolName"]) === subject,
  );
  if (retry) output.push(related(retry, "retry"));
  const fallback = later.find(
    (candidate) =>
      candidate.event.type === "route_attempt_started" ||
      safeToken(record(candidate.event.payload)?.["fallbackReason"]) !==
        undefined,
  );
  if (fallback && fallback.event.id !== retry?.event.id) {
    output.push(related(fallback, "fallback"));
  }
  return output.slice(0, 4);
}

function related(
  event: TraceTrajectoryEvent,
  relation: TraceTrajectoryRelatedEvent["relation"],
): TraceTrajectoryRelatedEvent {
  return {
    eventId: event.event.id,
    label: event.label,
    relation,
    sequence: event.event.seq,
  };
}

function traceCallKey(event: RunEvent): string | undefined {
  const payload = record(event.payload);
  const callId = safeToken(payload?.["callId"]);
  if (callId) return `tool:${event.runId}:${callId}`;
  const attemptId = safeToken(payload?.["attemptId"]);
  return attemptId ? `route:${event.runId}:${attemptId}` : undefined;
}

function contextFields(
  event: TraceTrajectoryEvent,
): TraceTrajectoryDetailField[] {
  return [
    field("eventType", event.event.type),
    field("role", event.role),
    field("lane", event.lane),
    field("category", event.event.category),
    field("visibility", event.event.visibility),
    field("run", shortIdentifier(event.event.runId)),
    field("sequence", `#${String(event.event.seq).padStart(3, "0")}`),
    field("turn", event.turnIndex === 0 ? "setup" : String(event.turnIndex)),
    ...(event.callOrdinal !== undefined
      ? [field("call", `C${String(event.callOrdinal)}`)]
      : []),
    field("summarySource", event.summarySource),
  ];
}

function evidenceFields(event: RunEvent): TraceTrajectoryDetailField[] {
  const fields = new Map<string, TraceTrajectoryDetailField>();
  const projection = dedicatedEvidenceProjection(event);
  for (const [key, value] of Object.entries(projection ?? {})) {
    if (!safeEvidenceValue(key, value)) continue;
    const digest = key.toLocaleLowerCase().endsWith("sha256");
    fields.set(
      key,
      field(key, digest ? shortDigest(String(value)) : String(value), digest),
    );
  }
  const payload = record(event.payload);
  if (payload) {
    const callId = safeToken(payload["callId"]);
    if (callId) fields.set("callId", field("callId", shortIdentifier(callId)));
    for (const key of GENERIC_DIGEST_FIELDS) {
      const digest = sha256(payload[key]);
      if (digest && !fields.has(key)) {
        fields.set(key, field(key, shortDigest(digest), true));
      }
    }
    for (const key of GENERIC_COUNT_FIELDS) {
      const count = nonNegativeNumber(payload[key]);
      if (count !== undefined && !fields.has(key)) {
        fields.set(key, field(key, String(count)));
      }
    }
    for (const item of traceTrajectoryModelUsageEvidence(payload)) {
      if (!fields.has(item.key)) fields.set(item.key, item);
    }
  }
  return [...fields.values()].slice(0, 24);
}

function dedicatedEvidenceProjection(event: RunEvent): object | undefined {
  if (event.type.startsWith("tool.")) return toolEventTraceView(event);
  if (event.type === "model.response") return modelResponseTraceView(event);
  if (event.type.startsWith("route_")) return modelRouteEventTraceView(event);
  if (event.type.startsWith("message.") || event.type.startsWith("system.")) {
    return messageEventTraceView(event);
  }
  if (event.type.startsWith("model.")) return modelEventTraceView(event);
  return undefined;
}

function safeEvidenceValue(
  key: string,
  value: unknown,
): value is string | number | boolean {
  if (key.toLocaleLowerCase().endsWith("sha256")) {
    return typeof value === "string" && SHA256.test(value);
  }
  if (
    key === "durationMs" ||
    key === "attempt" ||
    key === "stepAttempt" ||
    key === "retryAfterMs" ||
    key === "backoffMs" ||
    key.endsWith("Tokens") ||
    key.endsWith("Bytes") ||
    key.endsWith("Count") ||
    key.endsWith("DurationMs") ||
    key.endsWith("AfterMs") ||
    key.endsWith("BackoffMs") ||
    key.toLocaleLowerCase().endsWith("costusd") ||
    key.endsWith("ExitCode") ||
    key === "turnIndex"
  ) {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (
    [
      "visibleOutputProduced",
      "outputChanged",
      "textChanged",
      "outputTruncated",
    ].includes(key)
  ) {
    return typeof value === "boolean";
  }
  if (key === "providerHint") {
    return (
      typeof value === "string" && /^[A-Za-z0-9._:/ -]{1,120}$/u.test(value)
    );
  }
  if (key === "candidateChain") {
    return (
      typeof value === "string" && /^[A-Za-z0-9_.:/@ >-]{1,500}$/u.test(value)
    );
  }
  return (
    [
      "action",
      "model",
      "stopReason",
      "modelCallPurpose",
      "toolName",
      "status",
      "effect",
      "role",
      "path",
      "resolutionSource",
      "candidateChain",
      "servingModel",
      "sourceModelId",
      "endpointProfileId",
      "endpointKind",
      "dialect",
      "credentialPoolId",
      "credentialSlotId",
      "credentialHealth",
      "cooldownUntil",
      "outcome",
      "failureClass",
      "fallbackReason",
      "sideEffectState",
    ].includes(key) &&
    typeof value === "string" &&
    SAFE_TOKEN.test(value)
  );
}

function field(
  key: string,
  value: string,
  digest = false,
): TraceTrajectoryDetailField {
  return { key, value, ...(digest ? { digest: true } : {}) };
}

function shortIdentifier(value: string): string {
  return value.length > 20 ? `${value.slice(0, 9)}…${value.slice(-7)}` : value;
}

function shortDigest(value: string): string {
  return SHA256.test(value) ? `${value.slice(0, 12)}…` : value;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value)
    ? value
    : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
