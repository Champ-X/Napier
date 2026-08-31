import type { RunEvent } from "@napier/contracts";

export type TraceTrajectoryRawFieldKind =
  | "reasoning"
  | "content"
  | "toolInput"
  | "toolOutput";

export type TraceTrajectoryRawFieldState =
  | "recorded"
  | "receipt_only"
  | "not_provided";

export interface TraceTrajectoryRawField {
  key: string;
  kind: TraceTrajectoryRawFieldKind;
  state: TraceTrajectoryRawFieldState;
  value?: string;
}

export interface TraceTrajectoryRawEventView {
  envelope: string;
  envelopeBytes: number;
  payloadFieldCount: number;
  fields: TraceTrajectoryRawField[];
}

const MODEL_CONTENT_EVENTS = new Set([
  "message.assistant",
  "model.response",
  "model.text.delta",
  "model.thinking.delta",
]);

const TOOL_INPUT_EVENTS = new Set([
  "context.tool_invocation",
  "tool.blocked",
  "tool.started",
]);

const TOOL_OUTPUT_EVENTS = new Set([
  "context.tool_result",
  "tool.completed",
  "tool.failed",
  "tool.result_reused",
]);

const REASONING_KEYS = [
  "reasoning",
  "thinking",
  "reasoningContent",
  "reasoning_content",
] as const;
const CONTENT_KEYS = ["text", "content"] as const;
const TOOL_INPUT_KEYS = [
  "input",
  "arguments",
  "args",
  "callInput",
  "toolInput",
  "workflowInput",
] as const;
const TOOL_OUTPUT_KEYS = [
  "output",
  "result",
  "outputText",
  "toolOutput",
  "workflowOutput",
  "error",
] as const;

/**
 * Projects the selected event without applying the bounded summary/evidence
 * projection used by the other Inspector tabs. This is intentionally a view
 * of the event object the web app actually received: values that were already
 * reduced to a digest or marked redacted upstream cannot be reconstructed here.
 */
export function traceTrajectoryRawEventView(
  event: RunEvent,
): TraceTrajectoryRawEventView {
  const envelope = JSON.stringify(event, null, 2);
  const payload = record(event.payload) ?? {};
  const fields: TraceTrajectoryRawField[] = [];

  if (MODEL_CONTENT_EVENTS.has(event.type)) {
    fields.push(reasoningField(event, payload));
    fields.push(contentField(event, payload));
  }
  if (TOOL_INPUT_EVENTS.has(event.type)) {
    fields.push(
      rawField(
        "toolInput",
        payload,
        TOOL_INPUT_KEYS,
        hasAny(payload, [
          "inputRedacted",
          "inputSha256",
          "callInputSha256",
          "argumentsSha256",
        ]),
      ),
    );
  }
  if (TOOL_OUTPUT_EVENTS.has(event.type)) {
    fields.push(
      rawField(
        "toolOutput",
        payload,
        TOOL_OUTPUT_KEYS,
        hasAny(payload, [
          "outputRedacted",
          "outputSha256",
          "outputTextSha256",
          "resultSha256",
          "errorSha256",
        ]),
      ),
    );
  }

  return {
    envelope,
    envelopeBytes: new TextEncoder().encode(envelope).byteLength,
    payloadFieldCount: Object.keys(payload).length,
    fields,
  };
}

function reasoningField(
  event: RunEvent,
  payload: Record<string, unknown>,
): TraceTrajectoryRawField {
  if (event.type === "model.thinking.delta") {
    const delta = displayValue(payload["delta"]);
    if (delta !== undefined) {
      return {
        key: "delta",
        kind: "reasoning",
        state: "recorded",
        value: delta,
      };
    }
    return {
      key: "reasoning",
      kind: "reasoning",
      state: hasAny(payload, ["redacted", "deltaSha256"])
        ? "receipt_only"
        : "not_provided",
    };
  }
  return rawField(
    "reasoning",
    payload,
    REASONING_KEYS,
    hasAny(payload, [
      "reasoningRedacted",
      "contentRedacted",
      "reasoningSha256",
      "reasoningBytes",
    ]),
  );
}

function contentField(
  event: RunEvent,
  payload: Record<string, unknown>,
): TraceTrajectoryRawField {
  if (event.type === "model.text.delta") {
    const delta = displayValue(payload["delta"]);
    if (delta !== undefined) {
      return { key: "delta", kind: "content", state: "recorded", value: delta };
    }
    return {
      key: "content",
      kind: "content",
      state: hasAny(payload, ["redacted", "deltaSha256"])
        ? "receipt_only"
        : "not_provided",
    };
  }
  return rawField(
    "content",
    payload,
    CONTENT_KEYS,
    hasAny(payload, [
      "contentRedacted",
      "textSha256",
      "textBytes",
      "contentSha256",
      "contentBytes",
    ]),
  );
}

function rawField(
  kind: TraceTrajectoryRawFieldKind,
  payload: Record<string, unknown>,
  keys: readonly string[],
  receiptOnly: boolean,
): TraceTrajectoryRawField {
  for (const key of keys) {
    const value = displayValue(payload[key]);
    if (value !== undefined) {
      return { key, kind, state: "recorded", value };
    }
  }
  return {
    key: kind,
    kind,
    state: receiptOnly ? "receipt_only" : "not_provided",
  };
}

function displayValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value === undefined) return undefined;
  return JSON.stringify(value, null, 2);
}

function hasAny(
  payload: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.some((key) => payload[key] !== undefined);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
