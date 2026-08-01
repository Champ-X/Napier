import type {
  CreateExecutionPlanWorkflowExperimentRequest,
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowExperimentResultFrame,
  RunEvent,
  StreamFrame,
} from "@napier/contracts";

import { validateStreamFrameRecord } from "./api";
import { throwNapierApiError } from "./api-error";
import { readSseJsonRecords } from "./sse-json";
import { canonicalJson, sha256Text } from "./stable-digest";
import { workflowExperimentPreviewMatchesMode } from "./workflow-experiment-mode-view";
import {
  validateWorkflowExperimentPreview,
  validateWorkflowExperimentResultFrame,
} from "./workflow-experiment-web-protocol";

const MAX_STREAM_DATA_BYTES = 12 * 1024 * 1024;
const MAX_STREAM_RECORD_BYTES = 6 * 1024 * 1024;
const MAX_PREVIEW_RESPONSE_BYTES = 2 * 1024 * 1024;

export type WorkflowExperimentWebRequest = Omit<
  CreateExecutionPlanWorkflowExperimentRequest,
  "planId"
>;

export type WorkflowExperimentWebFrame =
  | StreamFrame
  | ExecutionPlanWorkflowExperimentResultFrame;

export {
  validateWorkflowExperimentPreview,
  validateWorkflowExperimentResultFrame,
} from "./workflow-experiment-web-protocol";

export async function previewWorkflowExperiment(
  threadId: string,
  planId: string,
  body: WorkflowExperimentWebRequest,
  signal?: AbortSignal,
): Promise<ExecutionPlanWorkflowExperimentPreview> {
  const path = experimentPath(threadId, planId, true);
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    await throwNapierApiError(
      response,
      "Workflow experiment preview failed",
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
    throw new Error("Workflow experiment preview response is invalid");
  }
  const preview = await validateWorkflowExperimentPreview(input);
  if (
    preview.sourceThreadId !== threadId ||
    preview.sourcePlanId !== planId ||
    preview.sourceManifestSha256 !== body.manifest.contentSha256 ||
    preview.fromNodeId !== body.fromNodeId ||
    !workflowExperimentPreviewMatchesMode(
      preview,
      body.manifest,
      body.fromNodeId,
      body.mode ?? "subgraph",
    ) ||
    canonicalJson(preview.modelOverrides) !==
      canonicalJson(body.modelOverrides ?? {})
  ) {
    throw new Error("Workflow experiment preview binding is invalid");
  }
  expectHeader(response.headers, "cache-control", "no-store");
  expectHeader(response.headers, "x-napier-content-sha256-mode", "stable");
  expectHeader(
    response.headers,
    "x-napier-content-sha256",
    preview.previewSha256,
  );
  expectHeader(
    response.headers,
    "x-napier-workflow-experiment-preview-sha256",
    preview.previewSha256,
  );
  return preview;
}

export async function executeWorkflowExperiment(
  threadId: string,
  planId: string,
  body: WorkflowExperimentWebRequest & { expectedPreviewSha256: string },
  expectedPreview: ExecutionPlanWorkflowExperimentPreview,
  onFrame?: (frame: WorkflowExperimentWebFrame) => void,
  signal?: AbortSignal,
): Promise<ExecutionPlanWorkflowExperimentResultFrame> {
  const path = experimentPath(threadId, planId, false);
  if (
    body.expectedPreviewSha256 !== expectedPreview.previewSha256 ||
    body.manifest.contentSha256 !== expectedPreview.sourceManifestSha256
  ) {
    throw new Error("Workflow experiment execution preview is stale");
  }
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    await throwNapierApiError(response, "Workflow experiment failed", path);
  }
  expectHeaderIncludes(response.headers, "content-type", "text/event-stream");
  expectHeader(response.headers, "cache-control", "no-store");
  expectHeader(response.headers, "x-napier-content-sha256-mode", "stable");
  expectHeader(
    response.headers,
    "x-napier-content-sha256",
    expectedPreview.previewSha256,
  );
  expectHeader(
    response.headers,
    "x-napier-workflow-experiment-preview-sha256",
    expectedPreview.previewSha256,
  );
  expectHeader(
    response.headers,
    "x-napier-workflow-experiment-source-manifest-sha256",
    expectedPreview.sourceManifestSha256,
  );
  expectHeader(
    response.headers,
    "x-napier-workflow-experiment-candidate-manifest-sha256",
    expectedPreview.candidateManifestSha256,
  );
  if (!response.body) {
    throw new Error("Workflow experiment stream is unavailable");
  }

  let frameCount = 0;
  let targetThreadId: string | undefined;
  let lastEventSeq: number | undefined;
  let snapshot: Extract<StreamFrame, { type: "snapshot" }> | undefined;
  let terminal:
    | ExecutionPlanWorkflowExperimentResultFrame
    | Extract<StreamFrame, { type: "error" }>
    | undefined;
  const streamedEventHashes = new Map<number, string>();

  for await (const record of readSseJsonRecords(path, response.body, {
    maxTotalBytes: MAX_STREAM_DATA_BYTES,
    maxRecordBytes: MAX_STREAM_RECORD_BYTES,
  })) {
    if (terminal) {
      throw new Error(
        "Workflow experiment stream emitted after terminal frame",
      );
    }
    const type = recordType(record.value);
    if (type === "workflow_experiment_result") {
      if (record.id !== undefined) {
        throw new Error("Workflow experiment result frame ID is invalid");
      }
      if (record.eventType && record.eventType !== type) {
        throw new Error("Workflow experiment SSE event type is invalid");
      }
      if (!snapshot) {
        throw new Error("Workflow experiment result is missing its snapshot");
      }
      const result = await validateWorkflowExperimentResultFrame(record.value);
      await assertExperimentResultBinding({
        result,
        sourceThreadId: threadId,
        sourcePlanId: planId,
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
      throw new Error("Workflow experiment stream used a Run done frame");
    }
    if (frame.type === "event") {
      if (snapshot) {
        throw new Error("Workflow experiment emitted an event after snapshot");
      }
      if (lastEventSeq !== undefined && frame.event.seq <= lastEventSeq) {
        throw new Error("Workflow experiment event sequence is not increasing");
      }
      lastEventSeq = frame.event.seq;
      targetThreadId ??= frame.event.threadId;
      if (frame.event.threadId !== targetThreadId) {
        throw new Error("Workflow experiment event Thread binding is invalid");
      }
      streamedEventHashes.set(frame.event.seq, frame.eventSha256);
    } else if (frame.type === "snapshot") {
      if (snapshot) {
        throw new Error("Workflow experiment emitted duplicate snapshots");
      }
      targetThreadId ??= frame.detail.thread.id;
      if (frame.detail.thread.id !== targetThreadId) {
        throw new Error(
          "Workflow experiment snapshot Thread binding is invalid",
        );
      }
      snapshot = frame;
    } else {
      const expectedThreadId = targetThreadId ?? threadId;
      if (frame.threadId !== expectedThreadId) {
        throw new Error("Workflow experiment error Thread binding is invalid");
      }
      terminal = frame;
    }
    onFrame?.(frame);
    frameCount += 1;
  }

  if (!terminal) {
    throw new Error(
      `Workflow experiment stream ended without terminal frame (${String(frameCount)} frames)`,
    );
  }
  if (terminal.type === "error") {
    throw new Error(
      `Workflow experiment failed (${terminal.diagnosticSha256.slice(0, 12)})`,
    );
  }
  return terminal;
}

async function assertExperimentResultBinding(input: {
  result: ExecutionPlanWorkflowExperimentResultFrame;
  sourceThreadId: string;
  sourcePlanId: string;
  preview: ExecutionPlanWorkflowExperimentPreview;
  snapshot: Extract<StreamFrame, { type: "snapshot" }>;
  targetThreadId: string | undefined;
  streamedEventHashes: ReadonlyMap<number, string>;
}): Promise<void> {
  const { result, snapshot } = input;
  const snapshotPlan = snapshot.detail.plans.find(
    (plan) => plan.id === result.targetPlanId,
  );
  const expectedPlanStatus =
    result.status === "completed"
      ? "completed"
      : result.status === "blocked"
        ? "blocked"
        : "active";
  const expectedThreadStatus =
    result.status === "waiting" || result.status === "paused"
      ? "waiting"
      : result.status === "blocked"
        ? "failed"
        : "idle";
  if (
    result.sourceThreadId !== input.sourceThreadId ||
    result.sourcePlanId !== input.sourcePlanId ||
    result.previewSha256 !== input.preview.previewSha256 ||
    result.candidateManifestSha256 !== input.preview.candidateManifestSha256 ||
    result.targetThreadId !== input.targetThreadId ||
    result.snapshotSha256 !== snapshot.detailSha256 ||
    result.snapshotBytes !== snapshot.detailBytes ||
    result.eventCount !== snapshot.detail.thread.eventCount ||
    result.eventBytes !== snapshot.eventBytes ||
    snapshotPlan?.status !== expectedPlanStatus ||
    snapshot.detail.thread.status !== expectedThreadStatus
  ) {
    throw new Error("Workflow experiment terminal binding is invalid");
  }
  if (
    result.status === "paused" &&
    !isExpectedReachedBreakpoint(
      snapshot.detail.events.find(
        (event) =>
          event.seq === result.experiment.result.breakpoint?.reachedEventSeq,
      ),
      result,
    )
  ) {
    throw new Error("Workflow experiment paused evidence is invalid");
  }
  const snapshotEvents = new Map(
    snapshot.detail.events.map((event) => [event.seq, event]),
  );
  for (const [seq, expectedHash] of input.streamedEventHashes) {
    const event = snapshotEvents.get(seq);
    if (!event) {
      throw new Error("Workflow experiment snapshot omitted a streamed event");
    }
    if ((await sha256Text(JSON.stringify(event))) !== expectedHash) {
      throw new Error("Workflow experiment snapshot changed a streamed event");
    }
  }
  const eventStreamSha256 = await sha256Text(
    snapshot.detail.events.map((event) => JSON.stringify(event)).join("\n"),
  );
  if (result.eventStreamSha256 !== eventStreamSha256) {
    throw new Error("Workflow experiment event stream hash is invalid");
  }
}

function isExpectedReachedBreakpoint(
  event: RunEvent | undefined,
  result: ExecutionPlanWorkflowExperimentResultFrame,
): boolean {
  const breakpoint = result.experiment.result.breakpoint;
  if (!event || !breakpoint || event.type !== "workflow.breakpoint.reached") {
    return false;
  }
  const payload = record(event.payload) ? event.payload : undefined;
  return (
    event.category === "plan" &&
    event.visibility === "user" &&
    payload?.["schemaVersion"] === 1 &&
    payload["planId"] === result.targetPlanId &&
    payload["manifestSha256"] === result.candidateManifestSha256 &&
    payload["nodeId"] === breakpoint.nodeId &&
    payload["breakpointIndex"] === breakpoint.breakpointIndex &&
    payload["breakpointCount"] === breakpoint.breakpointCount &&
    payload["bindingContextSha256"] === breakpoint.bindingContextSha256
  );
}

function experimentPath(
  threadId: string,
  planId: string,
  preview: boolean,
): string {
  const base = `/api/threads/${encodeURIComponent(threadId)}/workflows/${encodeURIComponent(planId)}/experiments`;
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
      throw new Error("Workflow experiment response exceeds its byte limit");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function expectHeader(headers: Headers, name: string, expected: string): void {
  const actual = headers.get(name);
  if (actual !== expected) {
    throw new Error(`Workflow experiment response header is invalid: ${name}`);
  }
}

function expectHeaderIncludes(
  headers: Headers,
  name: string,
  expected: string,
): void {
  const actual = headers.get(name)?.toLowerCase();
  if (!actual?.includes(expected)) {
    throw new Error(`Workflow experiment response header is invalid: ${name}`);
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
