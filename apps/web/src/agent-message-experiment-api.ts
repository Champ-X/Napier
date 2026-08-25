import type {
  AgentMessageExperimentPreview,
  AgentMessageExperimentResultFrame,
  CreateAgentMessageExperimentRequest,
  StreamFrame,
} from "@napier/contracts";
import {
  validateAgentMessageExperimentPreview,
  validateAgentMessageExperimentResultFrame,
} from "@napier/contracts";

import { validateStreamFrameRecord } from "./api";
import { throwNapierApiError } from "./api-error";
import { readSseJsonRecords } from "./sse-json";
import { canonicalJson, sha256Text } from "./stable-digest";

const MAX_STREAM_DATA_BYTES = 12 * 1024 * 1024;
const MAX_STREAM_RECORD_BYTES = 6 * 1024 * 1024;
const MAX_PREVIEW_RESPONSE_BYTES = 2 * 1024 * 1024;

export type AgentMessageExperimentWebRequest = Omit<
  CreateAgentMessageExperimentRequest,
  "expectedPreviewSha256"
>;

export type AgentMessageExperimentWebFrame =
  | StreamFrame
  | AgentMessageExperimentResultFrame;

export {
  validateAgentMessageExperimentPreview,
  validateAgentMessageExperimentResultFrame,
} from "@napier/contracts";

export async function previewAgentMessageExperiment(
  threadId: string,
  body: AgentMessageExperimentWebRequest,
  signal?: AbortSignal,
): Promise<AgentMessageExperimentPreview> {
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
      "Agent message experiment preview failed",
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
    throw new Error("Agent message experiment preview response is invalid");
  }
  const preview = await validateAgentMessageExperimentPreview(input);
  if (
    preview.sourceThreadId !== threadId ||
    preview.sourceRunId !== body.sourceRunId ||
    preview.sourceMessageSeq !== body.sourceMessageSeq ||
    preview.toolResultMode !== (body.toolResultMode ?? "live") ||
    canonicalJson(preview.targetModel) !==
      canonicalJson(body.model ?? preview.sourceModel)
  ) {
    throw new Error("Agent message experiment preview binding is invalid");
  }
  expectPreviewHeaders(response.headers, preview.previewSha256);
  return preview;
}

export async function executeAgentMessageExperiment(
  threadId: string,
  body: AgentMessageExperimentWebRequest & {
    expectedPreviewSha256: string;
  },
  expectedPreview: AgentMessageExperimentPreview,
  onFrame?: (frame: AgentMessageExperimentWebFrame) => void,
  signal?: AbortSignal,
): Promise<AgentMessageExperimentResultFrame> {
  const path = experimentPath(threadId, false);
  if (
    body.expectedPreviewSha256 !== expectedPreview.previewSha256 ||
    body.sourceRunId !== expectedPreview.sourceRunId ||
    body.sourceMessageSeq !== expectedPreview.sourceMessageSeq ||
    (body.toolResultMode ?? "live") !== expectedPreview.toolResultMode ||
    canonicalJson(body.model ?? expectedPreview.sourceModel) !==
      canonicalJson(expectedPreview.targetModel)
  ) {
    throw new Error("Agent message experiment execution preview is stale");
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
      "Agent message experiment failed",
      path,
    );
  }
  expectHeaderIncludes(response.headers, "content-type", "text/event-stream");
  expectPreviewHeaders(response.headers, expectedPreview.previewSha256);
  expectHeader(
    response.headers,
    "x-napier-agent-experiment-workspace-sha256",
    expectedPreview.candidateWorkspaceSnapshotSha256,
  );
  if (!response.body) {
    throw new Error("Agent message experiment stream is unavailable");
  }

  let frameCount = 0;
  let targetThreadId: string | undefined;
  let lastEventSeq: number | undefined;
  let snapshot: Extract<StreamFrame, { type: "snapshot" }> | undefined;
  let terminal:
    | AgentMessageExperimentResultFrame
    | Extract<StreamFrame, { type: "error" }>
    | undefined;
  const streamedEventHashes = new Map<number, string>();

  for await (const record of readSseJsonRecords(path, response.body, {
    maxTotalBytes: MAX_STREAM_DATA_BYTES,
    maxRecordBytes: MAX_STREAM_RECORD_BYTES,
  })) {
    if (terminal) {
      throw new Error(
        "Agent message experiment stream emitted after terminal frame",
      );
    }
    const type = recordType(record.value);
    if (type === "agent_message_experiment_result") {
      if (record.id !== undefined) {
        throw new Error("Agent message experiment result frame ID is invalid");
      }
      if (record.eventType && record.eventType !== type) {
        throw new Error("Agent message experiment SSE event type is invalid");
      }
      if (!snapshot) {
        throw new Error(
          "Agent message experiment result is missing its snapshot",
        );
      }
      const result = await validateAgentMessageExperimentResultFrame(
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
      throw new Error("Agent message experiment stream used a Run done frame");
    }
    if (frame.type === "event") {
      if (snapshot) {
        throw new Error(
          "Agent message experiment emitted an event after snapshot",
        );
      }
      if (lastEventSeq !== undefined && frame.event.seq <= lastEventSeq) {
        throw new Error(
          "Agent message experiment event sequence is not increasing",
        );
      }
      lastEventSeq = frame.event.seq;
      targetThreadId ??= frame.event.threadId;
      if (frame.event.threadId !== targetThreadId) {
        throw new Error(
          "Agent message experiment event Thread binding is invalid",
        );
      }
      streamedEventHashes.set(frame.event.seq, frame.eventSha256);
    } else if (frame.type === "snapshot") {
      if (snapshot) {
        throw new Error("Agent message experiment emitted duplicate snapshots");
      }
      targetThreadId ??= frame.detail.thread.id;
      if (frame.detail.thread.id !== targetThreadId) {
        throw new Error(
          "Agent message experiment snapshot Thread binding is invalid",
        );
      }
      snapshot = frame;
    } else {
      const expectedThreadId = targetThreadId ?? threadId;
      if (frame.threadId !== expectedThreadId) {
        throw new Error(
          "Agent message experiment error Thread binding is invalid",
        );
      }
      terminal = frame;
    }
    onFrame?.(frame);
    frameCount += 1;
  }

  if (!terminal) {
    throw new Error(
      `Agent message experiment stream ended without terminal frame (${String(frameCount)} frames)`,
    );
  }
  if (terminal.type === "error") {
    throw new Error(
      `Agent message experiment failed (${terminal.diagnosticSha256.slice(0, 12)})`,
    );
  }
  return terminal;
}

async function assertResultBinding(input: {
  result: AgentMessageExperimentResultFrame;
  sourceThreadId: string;
  preview: AgentMessageExperimentPreview;
  snapshot: Extract<StreamFrame, { type: "snapshot" }>;
  targetThreadId: string | undefined;
  streamedEventHashes: ReadonlyMap<number, string>;
}): Promise<void> {
  const { result, snapshot } = input;
  if (
    result.sourceThreadId !== input.sourceThreadId ||
    result.sourceRunId !== input.preview.sourceRunId ||
    result.sourceMessageSeq !== input.preview.sourceMessageSeq ||
    result.previewSha256 !== input.preview.previewSha256 ||
    result.targetThreadId !== input.targetThreadId ||
    result.snapshotSha256 !== snapshot.detailSha256 ||
    result.snapshotBytes !== snapshot.detailBytes ||
    result.eventCount !== snapshot.detail.thread.eventCount ||
    result.eventBytes !== snapshot.eventBytes ||
    !snapshot.detail.runs.some((run) => run.id === result.targetRunId)
  ) {
    throw new Error("Agent message experiment terminal binding is invalid");
  }
  const snapshotEvents = new Map(
    snapshot.detail.events.map((event) => [event.seq, event]),
  );
  for (const [seq, expectedHash] of input.streamedEventHashes) {
    const event = snapshotEvents.get(seq);
    if (!event) {
      throw new Error(
        "Agent message experiment snapshot omitted a streamed event",
      );
    }
    if ((await sha256Text(JSON.stringify(event))) !== expectedHash) {
      throw new Error(
        "Agent message experiment snapshot changed a streamed event",
      );
    }
  }
  const eventStreamSha256 = await sha256Text(
    snapshot.detail.events.map((event) => JSON.stringify(event)).join("\n"),
  );
  if (result.eventStreamSha256 !== eventStreamSha256) {
    throw new Error("Agent message experiment event stream hash is invalid");
  }
}

function experimentPath(threadId: string, preview: boolean): string {
  const base = `/api/threads/${encodeURIComponent(threadId)}/agent-experiments`;
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
        "Agent message experiment response exceeds its byte limit",
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
    "x-napier-agent-experiment-preview-sha256",
    previewSha256,
  );
}

function expectHeader(headers: Headers, name: string, expected: string): void {
  if (headers.get(name) !== expected) {
    throw new Error(
      `Agent message experiment response header is invalid: ${name}`,
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
      `Agent message experiment response header is invalid: ${name}`,
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
