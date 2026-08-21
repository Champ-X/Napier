import type { RunEvent } from "@napier/contracts";

import { messageEventTraceView } from "./message-event-view";
import { modelEventTraceView } from "./model-event-view";
import { modelResponseTraceView } from "./model-response-view";
import { toolEventTraceView } from "./tool-event-view";
import type { TraceTrajectoryEvent } from "./trace-trajectory-model";

export interface TraceTrajectoryDetailField {
  key: string;
  value: string;
  digest?: boolean;
}

export interface TraceTrajectoryEventDetailView {
  context: TraceTrajectoryDetailField[];
  evidence: TraceTrajectoryDetailField[];
  timing: TraceTrajectoryDetailField[];
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
): TraceTrajectoryEventDetailView {
  return {
    context: contextFields(event),
    evidence: evidenceFields(event.event),
    timing: timingFields(event),
  };
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
  }
  return [...fields.values()].slice(0, 18);
}

function timingFields(
  event: TraceTrajectoryEvent,
): TraceTrajectoryDetailField[] {
  const finishedAt = event.timestampMs;
  const startedAt =
    event.durationMs === undefined ? undefined : finishedAt - event.durationMs;
  return [
    ...(startedAt !== undefined
      ? [field("startedAt", formatTimestamp(startedAt))]
      : []),
    field(
      event.durationMs === undefined ? "recordedAt" : "finishedAt",
      formatTimestamp(finishedAt),
    ),
    ...(event.durationMs !== undefined
      ? [field("duration", formatDuration(event.durationMs))]
      : []),
  ];
}

function dedicatedEvidenceProjection(event: RunEvent): object | undefined {
  if (event.type.startsWith("tool.")) return toolEventTraceView(event);
  if (event.type === "model.response") return modelResponseTraceView(event);
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
    key.endsWith("Tokens") ||
    key.endsWith("Bytes") ||
    key.endsWith("Count") ||
    key.endsWith("DurationMs") ||
    key.endsWith("CostUsd") ||
    key.endsWith("ExitCode") ||
    key === "turnIndex"
  ) {
    return typeof value === "number" && Number.isFinite(value);
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

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  }).format(new Date(value));
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${String(Math.round(milliseconds))} ms`;
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 2 : 1)} s`;
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
