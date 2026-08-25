import type {
  CreateToolInvocationExperimentRequest,
  StreamFrame,
  ToolInvocationExperimentPreview,
  ToolInvocationExperimentResultFrame,
} from "@napier/contracts";
import {
  validateToolInvocationExperimentPreview,
  validateToolInvocationExperimentResultFrame,
} from "@napier/contracts";

import { validateStreamFrameRecord } from "./api";
import { throwNapierApiError } from "./api-error";
import { readSseJsonRecords } from "./sse-json";
import { sha256Text } from "./stable-digest";

const MAX_STREAM_DATA_BYTES = 8 * 1024 * 1024;
const MAX_STREAM_RECORD_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_RESPONSE_BYTES = 512 * 1024;

export type ToolInvocationExperimentWebRequest = Omit<
  CreateToolInvocationExperimentRequest,
  "expectedPreviewSha256"
>;

export type ToolInvocationExperimentWebFrame =
  | StreamFrame
  | ToolInvocationExperimentResultFrame;

export async function previewToolInvocationExperiment(
  threadId: string,
  body: ToolInvocationExperimentWebRequest,
  signal?: AbortSignal,
): Promise<ToolInvocationExperimentPreview> {
  const path = experimentPath(threadId, true);
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    await throwNapierApiError(
      response,
      "Tool invocation experiment preview failed",
      path,
    );
  }
  expectHeaderIncludes(response.headers, "content-type", "application/json");
  let input: unknown;
  try {
    input = JSON.parse(
      await readBoundedResponseText(response, MAX_PREVIEW_RESPONSE_BYTES),
    );
  } catch {
    throw new Error("Tool invocation experiment preview response is invalid");
  }
  const preview = await validateToolInvocationExperimentPreview(input);
  if (
    preview.sourceThreadId !== threadId ||
    preview.sourceRunId !== body.sourceRunId ||
    preview.sourceCallId !== body.sourceCallId
  ) {
    throw new Error("Tool invocation experiment preview binding is invalid");
  }
  expectPreviewHeaders(response.headers, preview.previewSha256);
  return preview;
}

export async function executeToolInvocationExperiment(
  threadId: string,
  body: ToolInvocationExperimentWebRequest & {
    expectedPreviewSha256: string;
  },
  expectedPreview: ToolInvocationExperimentPreview,
  onFrame?: (frame: ToolInvocationExperimentWebFrame) => void,
  signal?: AbortSignal,
): Promise<ToolInvocationExperimentResultFrame> {
  const path = experimentPath(threadId, false);
  if (
    body.expectedPreviewSha256 !== expectedPreview.previewSha256 ||
    body.sourceRunId !== expectedPreview.sourceRunId ||
    body.sourceCallId !== expectedPreview.sourceCallId
  ) {
    throw new Error("Tool invocation experiment execution preview is stale");
  }
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    await throwNapierApiError(
      response,
      "Tool invocation experiment failed",
      path,
    );
  }
  expectHeaderIncludes(response.headers, "content-type", "text/event-stream");
  expectPreviewHeaders(response.headers, expectedPreview.previewSha256);
  if (!response.body) {
    throw new Error("Tool invocation experiment stream is unavailable");
  }

  let frameCount = 0;
  let targetThreadId: string | undefined;
  let lastEventSeq: number | undefined;
  let snapshot: Extract<StreamFrame, { type: "snapshot" }> | undefined;
  let terminal:
    | ToolInvocationExperimentResultFrame
    | Extract<StreamFrame, { type: "error" }>
    | undefined;
  const streamedEventHashes = new Map<number, string>();

  for await (const record of readSseJsonRecords(path, response.body, {
    maxTotalBytes: MAX_STREAM_DATA_BYTES,
    maxRecordBytes: MAX_STREAM_RECORD_BYTES,
  })) {
    if (terminal) {
      throw new Error(
        "Tool invocation experiment stream emitted after terminal",
      );
    }
    const type = recordType(record.value);
    if (type === "tool_invocation_experiment_result") {
      if (record.id !== undefined) {
        throw new Error(
          "Tool invocation experiment result frame ID is invalid",
        );
      }
      if (record.eventType && record.eventType !== type) {
        throw new Error("Tool invocation experiment SSE event type is invalid");
      }
      if (!snapshot) {
        throw new Error(
          "Tool invocation experiment result is missing its snapshot",
        );
      }
      const result = await validateToolInvocationExperimentResultFrame(
        record.value,
      );
      await assertResultBinding({
        result,
        sourceThreadId: threadId,
        preview: expectedPreview,
        snapshot,
        targetThreadId,
        streamedEventHashes,
      });
      terminal = result;
      onFrame?.(result);
      frameCount += 1;
      continue;
    }

    const parsed = await validateStreamFrameRecord(path, record);
    const frame = parsed.frame;
    if (frame.type === "done") {
      throw new Error(
        "Tool invocation experiment stream used a Run done frame",
      );
    }
    if (frame.type === "event") {
      if (snapshot) {
        throw new Error(
          "Tool invocation experiment emitted an event after snapshot",
        );
      }
      if (lastEventSeq !== undefined && frame.event.seq <= lastEventSeq) {
        throw new Error(
          "Tool invocation experiment event sequence is not increasing",
        );
      }
      lastEventSeq = frame.event.seq;
      targetThreadId ??= frame.event.threadId;
      if (frame.event.threadId !== targetThreadId) {
        throw new Error(
          "Tool invocation experiment event Thread binding is invalid",
        );
      }
      streamedEventHashes.set(frame.event.seq, frame.eventSha256);
    } else if (frame.type === "snapshot") {
      if (snapshot) {
        throw new Error(
          "Tool invocation experiment emitted duplicate snapshots",
        );
      }
      targetThreadId ??= frame.detail.thread.id;
      if (frame.detail.thread.id !== targetThreadId) {
        throw new Error(
          "Tool invocation experiment snapshot Thread binding is invalid",
        );
      }
      snapshot = frame;
    } else {
      const expectedThreadId = targetThreadId ?? threadId;
      if (frame.threadId !== expectedThreadId) {
        throw new Error(
          "Tool invocation experiment error Thread binding is invalid",
        );
      }
      terminal = frame;
    }
    onFrame?.(frame);
    frameCount += 1;
  }

  if (!terminal) {
    throw new Error(
      `Tool invocation experiment stream ended without terminal frame (${String(frameCount)} frames)`,
    );
  }
  if (terminal.type === "error") {
    throw new Error(
      `Tool invocation experiment failed (${terminal.diagnosticSha256.slice(0, 12)})`,
    );
  }
  return terminal;
}

async function assertResultBinding(input: {
  result: ToolInvocationExperimentResultFrame;
  sourceThreadId: string;
  preview: ToolInvocationExperimentPreview;
  snapshot: Extract<StreamFrame, { type: "snapshot" }>;
  targetThreadId: string | undefined;
  streamedEventHashes: ReadonlyMap<number, string>;
}): Promise<void> {
  const { result, snapshot } = input;
  if (
    result.sourceThreadId !== input.sourceThreadId ||
    result.sourceRunId !== input.preview.sourceRunId ||
    result.sourceCallId !== input.preview.sourceCallId ||
    result.previewSha256 !== input.preview.previewSha256 ||
    result.targetThreadId !== input.targetThreadId ||
    result.snapshotSha256 !== snapshot.detailSha256 ||
    result.snapshotBytes !== snapshot.detailBytes ||
    result.eventCount !== snapshot.detail.thread.eventCount ||
    result.eventBytes !== snapshot.eventBytes ||
    !snapshot.detail.runs.some((run) => run.id === result.targetRunId)
  ) {
    throw new Error("Tool invocation experiment terminal binding is invalid");
  }
  const snapshotEvents = new Map(
    snapshot.detail.events.map((event) => [event.seq, event]),
  );
  for (const [seq, expectedHash] of input.streamedEventHashes) {
    const event = snapshotEvents.get(seq);
    if (!event) {
      throw new Error(
        "Tool invocation experiment snapshot omitted a streamed event",
      );
    }
    if ((await sha256Text(JSON.stringify(event))) !== expectedHash) {
      throw new Error(
        "Tool invocation experiment snapshot changed a streamed event",
      );
    }
  }
  const eventStreamSha256 = await sha256Text(
    snapshot.detail.events.map((event) => JSON.stringify(event)).join("\n"),
  );
  if (result.eventStreamSha256 !== eventStreamSha256) {
    throw new Error("Tool invocation experiment event stream hash is invalid");
  }
}

function experimentPath(threadId: string, preview: boolean): string {
  const base = `/api/threads/${encodeURIComponent(
    threadId,
  )}/tool-invocation-experiments`;
  return preview ? `${base}/preview` : base;
}

async function readBoundedResponseText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  if (!response.body) throw new Error("Response body is unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      throw new Error(
        "Tool invocation experiment response exceeds its byte limit",
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function expectPreviewHeaders(headers: Headers, previewSha256: string): void {
  expectHeader(headers, "cache-control", "no-store");
  expectHeader(headers, "x-napier-content-sha256-mode", "stable");
  expectHeader(headers, "x-napier-content-sha256", previewSha256);
  expectHeader(
    headers,
    "x-napier-tool-invocation-experiment-preview-sha256",
    previewSha256,
  );
}

function expectHeader(headers: Headers, name: string, expected: string): void {
  if (headers.get(name) !== expected) {
    throw new Error(
      `Tool invocation experiment response header is invalid: ${name}`,
    );
  }
}

function expectHeaderIncludes(
  headers: Headers,
  name: string,
  expected: string,
): void {
  if (!headers.get(name)?.toLowerCase().includes(expected)) {
    throw new Error(
      `Tool invocation experiment response header is invalid: ${name}`,
    );
  }
}

function recordType(input: unknown): string | undefined {
  return record(input) && typeof input["type"] === "string"
    ? input["type"]
    : undefined;
}

function record(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}
