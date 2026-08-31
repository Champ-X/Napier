import type { TraceTrajectoryEvent } from "./trace-trajectory-model";

interface TraceDetailField {
  key: string;
  value: string;
  digest?: boolean;
}

interface TraceRequestWindow {
  started?: TraceTrajectoryEvent;
  finished?: TraceTrajectoryEvent;
  response?: TraceTrajectoryEvent;
  firstReasoningDelta?: TraceTrajectoryEvent;
  firstContentDelta?: TraceTrajectoryEvent;
}

const SAFE_TOKEN = /^[A-Za-z0-9_.:/@-]{1,180}$/u;
const USAGE_KEYS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "contentTokens",
] as const;

export function traceTrajectoryEventKeyPath(
  event: TraceTrajectoryEvent,
  evidence: readonly TraceDetailField[],
): string {
  const values = new Map(evidence.map((item) => [item.key, item.value]));
  const subject =
    values.get("servingModel") ?? values.get("model") ?? values.get("toolName");
  const action = values.get("action") ?? event.event.type;
  return [
    event.role,
    action,
    subject,
    labeled("attempt", values.get("attempt")),
    labeled("step", values.get("stepAttempt")),
    event.turnIndex > 0 ? `turn ${String(event.turnIndex)}` : undefined,
    event.callOrdinal === undefined
      ? undefined
      : `call C${String(event.callOrdinal)}`,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" / ");
}

export function traceTrajectoryRequestMetrics(
  event: TraceTrajectoryEvent,
  events: readonly TraceTrajectoryEvent[],
  evidence: readonly TraceDetailField[],
): TraceDetailField[] {
  const request = requestWindow(event, events);
  const responseEvidence = request.response
    ? traceTrajectoryModelUsageEvidence(request.response.event.payload)
    : evidence;
  const values = new Map(
    responseEvidence.map((item) => [item.key, item.value]),
  );
  const duration = requestDurationMs(request) ?? event.durationMs;
  return [
    metric("totalTokens", values.get("totalTokens")),
    metric("reasoningBytes", values.get("reasoningBytes")),
    metric("contentBytes", values.get("contentBytes")),
    metric(
      "requestDuration",
      duration === undefined ? undefined : formatDuration(duration),
    ),
  ].filter((item): item is TraceDetailField => item !== undefined);
}

export function traceTrajectoryTimingFields(
  event: TraceTrajectoryEvent,
  events: readonly TraceTrajectoryEvent[],
): TraceDetailField[] {
  const request = requestWindow(event, events);
  const requestStartedAt = request.started?.timestampMs;
  const requestFinishedAt = request.finished?.timestampMs;
  const finishedAt = requestFinishedAt ?? event.timestampMs;
  const startedAt =
    requestStartedAt ??
    (event.durationMs === undefined
      ? undefined
      : finishedAt - event.durationMs);
  const requestDuration = requestDurationMs(request);
  const firstReasoningAt = request.firstReasoningDelta?.timestampMs;
  const firstContentAt = request.firstContentDelta?.timestampMs;
  const firstTokenAt = earliest(firstReasoningAt, firstContentAt);
  const usage = traceTrajectoryModelUsageEvidence(
    request.response?.event.payload ?? event.event.payload,
  );
  const outputTokens = numberFieldValue(usage, "outputTokens");
  const generationDuration = elapsed(firstTokenAt, finishedAt);
  const throughputWindow = generationDuration ?? requestDuration;
  const throughput = rate(outputTokens, throughputWindow);
  return [
    metric(
      "startedAt",
      startedAt === undefined ? undefined : formatTimestamp(startedAt),
    ),
    field(
      requestFinishedAt === undefined && event.durationMs === undefined
        ? "recordedAt"
        : "finishedAt",
      formatTimestamp(finishedAt),
    ),
    metric(
      requestDuration === undefined ? "duration" : "requestDuration",
      formatOptionalDuration(requestDuration ?? event.durationMs),
    ),
    metric("ttft", latency(startedAt, firstTokenAt)),
    metric("contentLatency", latency(startedAt, firstContentAt)),
    metric("generationDuration", formatOptionalDuration(generationDuration)),
    metric(
      generationDuration === undefined ? "requestThroughput" : "throughput",
      throughput === undefined ? undefined : `${throughput.toFixed(1)} tok/s`,
    ),
  ].filter((item): item is TraceDetailField => item !== undefined);
}

export function traceTrajectoryModelUsageEvidence(
  payloadValue: unknown,
): TraceDetailField[] {
  const payload = record(payloadValue);
  if (!payload) return [];
  const fields = new Map<string, TraceDetailField>();
  const usage = record(payload["usage"]);
  if (usage) addUsageFields(fields, usage, payload);
  addReceiptSize(fields, "contentBytes", payload["text"]);
  addReceiptSize(fields, "reasoningBytes", payload["reasoning"]);
  return [...fields.values()];
}

function addUsageFields(
  fields: Map<string, TraceDetailField>,
  usage: Record<string, unknown>,
  payload: Record<string, unknown>,
): void {
  for (const key of USAGE_KEYS) {
    const value = nonNegativeNumber(usage[key]);
    if (value !== undefined) fields.set(key, field(key, String(value)));
  }
  const accounting = record(payload["usageAccounting"]);
  const reportedTotal = nonNegativeNumber(accounting?.["rawTotalTokens"]);
  const calculatedTotal = USAGE_KEYS.slice(0, 4).reduce(
    (total, key) => total + (nonNegativeNumber(usage[key]) ?? 0),
    0,
  );
  const totalTokens = reportedTotal ?? calculatedTotal;
  if (totalTokens > 0) {
    fields.set("totalTokens", field("totalTokens", String(totalTokens)));
  }
  const costUsd =
    nonNegativeNumber(usage["costUsd"]) ??
    nonNegativeNumber(accounting?.["reportedCostUsd"]);
  if (costUsd !== undefined) {
    fields.set("costUsd", field("costUsd", formatCost(costUsd)));
  }
}

function addReceiptSize(
  fields: Map<string, TraceDetailField>,
  key: string,
  value: unknown,
): void {
  if (typeof value !== "string") return;
  fields.set(
    key,
    field(key, String(new TextEncoder().encode(value).byteLength)),
  );
}

function requestWindow(
  event: TraceTrajectoryEvent,
  events: readonly TraceTrajectoryEvent[],
): TraceRequestWindow {
  if (!requestEvent(event)) return {};
  const ordered = events
    .filter((candidate) => candidate.event.runId === event.event.runId)
    .slice()
    .sort((left, right) => left.event.seq - right.event.seq);
  const selectedIndex = ordered.findIndex(
    (candidate) => candidate.event.id === event.event.id,
  );
  if (selectedIndex < 0) return {};
  const attemptId = safeToken(record(event.event.payload)?.["attemptId"]);
  const { started, finished } = requestAnchors(
    event,
    ordered,
    selectedIndex,
    attemptId,
  );
  const response = requestResponse(event, ordered, finished);
  const deltas = requestDeltas(event, ordered, started, finished, response);
  return {
    ...(started ? { started } : {}),
    ...(finished ? { finished } : {}),
    ...(response ? { response } : {}),
    ...deltas,
  };
}

function requestAnchors(
  event: TraceTrajectoryEvent,
  ordered: readonly TraceTrajectoryEvent[],
  selectedIndex: number,
  attemptId: string | undefined,
): Pick<TraceRequestWindow, "started" | "finished"> {
  const exactStart = findAttemptEvent(
    ordered,
    "route_attempt_started",
    attemptId,
  );
  const exactFinish = findAttemptEvent(
    ordered,
    "route_attempt_ended",
    attemptId,
  );
  const started =
    event.event.type === "route_attempt_started"
      ? event
      : (exactStart ?? nearestRouteStart(ordered, selectedIndex));
  const finished =
    event.event.type === "route_attempt_ended"
      ? event
      : (exactFinish ?? nextRouteFinish(ordered, started));
  return { ...(started ? { started } : {}), ...(finished ? { finished } : {}) };
}

function findAttemptEvent(
  events: readonly TraceTrajectoryEvent[],
  type: string,
  attemptId: string | undefined,
): TraceTrajectoryEvent | undefined {
  if (!attemptId) return undefined;
  return events.find(
    (candidate) =>
      candidate.event.type === type &&
      safeToken(record(candidate.event.payload)?.["attemptId"]) === attemptId,
  );
}

function nearestRouteStart(
  events: readonly TraceTrajectoryEvent[],
  selectedIndex: number,
): TraceTrajectoryEvent | undefined {
  return events
    .slice(0, selectedIndex + 1)
    .reverse()
    .find((candidate) => candidate.event.type === "route_attempt_started");
}

function nextRouteFinish(
  events: readonly TraceTrajectoryEvent[],
  started: TraceTrajectoryEvent | undefined,
): TraceTrajectoryEvent | undefined {
  if (!started) return undefined;
  const index = events.findIndex(
    (candidate) => candidate.event.id === started.event.id,
  );
  return events
    .slice(index + 1)
    .find((candidate) => candidate.event.type === "route_attempt_ended");
}

function requestResponse(
  event: TraceTrajectoryEvent,
  events: readonly TraceTrajectoryEvent[],
  finished: TraceTrajectoryEvent | undefined,
): TraceTrajectoryEvent | undefined {
  if (event.event.type === "model.response") return event;
  const finishSequence = finished?.event.seq ?? event.event.seq;
  return events.find(
    (candidate) =>
      candidate.event.type === "model.response" &&
      candidate.event.seq > finishSequence &&
      candidate.event.seq <= finishSequence + 2,
  );
}

function requestDeltas(
  event: TraceTrajectoryEvent,
  events: readonly TraceTrajectoryEvent[],
  started: TraceTrajectoryEvent | undefined,
  finished: TraceTrajectoryEvent | undefined,
  response: TraceTrajectoryEvent | undefined,
): Pick<TraceRequestWindow, "firstReasoningDelta" | "firstContentDelta"> {
  const startSequence = started?.event.seq ?? event.event.seq;
  const finishSequence =
    response?.event.seq ?? finished?.event.seq ?? event.event.seq;
  const windowEvents = events.filter(
    (candidate) =>
      candidate.event.seq >= startSequence &&
      candidate.event.seq <= finishSequence,
  );
  const firstReasoningDelta = windowEvents.find(
    (candidate) => candidate.event.type === "model.thinking.delta",
  );
  const firstContentDelta = windowEvents.find(
    (candidate) => candidate.event.type === "model.text.delta",
  );
  return {
    ...(firstReasoningDelta ? { firstReasoningDelta } : {}),
    ...(firstContentDelta ? { firstContentDelta } : {}),
  };
}

function requestEvent(event: TraceTrajectoryEvent): boolean {
  return (
    event.event.type.startsWith("route_") ||
    event.event.type === "model.response"
  );
}

function requestDurationMs(request: TraceRequestWindow): number | undefined {
  return request.started && request.finished
    ? Math.max(0, request.finished.timestampMs - request.started.timestampMs)
    : undefined;
}

function earliest(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}

function elapsed(
  startedAt: number | undefined,
  finishedAt: number,
): number | undefined {
  return startedAt === undefined
    ? undefined
    : Math.max(0, finishedAt - startedAt);
}

function latency(
  startedAt: number | undefined,
  milestoneAt: number | undefined,
): string | undefined {
  return startedAt === undefined || milestoneAt === undefined
    ? undefined
    : formatDuration(Math.max(0, milestoneAt - startedAt));
}

function rate(
  outputTokens: number | undefined,
  durationMs: number | undefined,
): number | undefined {
  return outputTokens === undefined ||
    durationMs === undefined ||
    durationMs <= 0
    ? undefined
    : (outputTokens * 1_000) / durationMs;
}

function numberFieldValue(
  fields: readonly TraceDetailField[],
  key: string,
): number | undefined {
  const value = Number(fields.find((item) => item.key === key)?.value);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function labeled(label: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : `${label} ${value}`;
}

function metric(
  key: string,
  value: string | undefined,
): TraceDetailField | undefined {
  return value === undefined ? undefined : field(key, value);
}

function field(key: string, value: string): TraceDetailField {
  return { key, value };
}

function formatOptionalDuration(value: number | undefined): string | undefined {
  return value === undefined ? undefined : formatDuration(value);
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${String(Math.round(milliseconds))} ms`;
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 2 : 1)} s`;
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

function formatCost(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 0.01 ? 6 : 2,
    maximumFractionDigits: value < 0.01 ? 6 : 4,
  }).format(value);
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

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}
