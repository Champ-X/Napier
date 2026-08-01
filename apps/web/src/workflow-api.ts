import type {
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowBreakpoint,
  ExecutionPlanWorkflowResultFrame,
  RunEvent,
  StreamFrame,
} from "@napier/contracts";

import { validateStreamFrameRecord } from "./api";
import { throwNapierApiError } from "./api-error";
import { readSseJsonRecords } from "./sse-json";
import { sha256Text } from "./stable-digest";
import type { OpenWorkflowBreakpoint } from "./workflow-breakpoint-view-model";
import { validateWorkflowResultFrame } from "./workflow-result-web-protocol";

const MAX_STREAM_DATA_BYTES = 12 * 1024 * 1024;
const MAX_STREAM_RECORD_BYTES = 6 * 1024 * 1024;

export type WorkflowWebFrame = StreamFrame | ExecutionPlanWorkflowResultFrame;

export async function continueWorkflowBreakpoint(
  threadId: string,
  manifest: ExecutionPlanWorkflowManifest,
  breakpoint: OpenWorkflowBreakpoint,
  onFrame?: (frame: WorkflowWebFrame) => void,
  signal?: AbortSignal,
): Promise<ExecutionPlanWorkflowResultFrame> {
  const path = `/api/threads/${encodeURIComponent(threadId)}/workflows`;
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      manifest,
      planId: breakpoint.planId,
      continueBreakpoint: true,
    }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    await throwNapierApiError(response, "Workflow continuation failed", path);
  }
  expectHeaderIncludes(response.headers, "content-type", "text/event-stream");
  expectHeader(response.headers, "cache-control", "no-cache");
  expectHeader(
    response.headers,
    "x-napier-workflow-manifest-sha256",
    manifest.contentSha256,
  );
  expectHeader(
    response.headers,
    "x-napier-workflow-blueprint-sha256",
    manifest.blueprint.contentSha256,
  );
  expectHeader(
    response.headers,
    "x-napier-workflow-version",
    String(manifest.version),
  );
  expectHeader(
    response.headers,
    "x-napier-workflow-node-count",
    String(manifest.nodeCount),
  );
  expectHeader(
    response.headers,
    "x-napier-workflow-max-concurrency",
    String(manifest.maxConcurrency ?? 1),
  );
  if (!response.body) throw new Error("Workflow stream is unavailable");

  let lastEventSeq: number | undefined;
  let snapshot: Extract<StreamFrame, { type: "snapshot" }> | undefined;
  let terminal:
    | ExecutionPlanWorkflowResultFrame
    | Extract<StreamFrame, { type: "error" }>
    | undefined;
  let continuationCount = 0;
  const streamedEventHashes = new Map<number, string>();

  for await (const record of readSseJsonRecords(path, response.body, {
    maxTotalBytes: MAX_STREAM_DATA_BYTES,
    maxRecordBytes: MAX_STREAM_RECORD_BYTES,
  })) {
    if (terminal) {
      throw new Error("Workflow stream emitted after its terminal frame");
    }
    if (recordType(record.value) === "workflow_result") {
      if (record.id !== undefined) {
        throw new Error("Workflow result frame ID is invalid");
      }
      if (record.eventType && record.eventType !== "workflow_result") {
        throw new Error("Workflow result SSE event type is invalid");
      }
      if (!snapshot) throw new Error("Workflow result is missing its snapshot");
      const result = await validateWorkflowResultFrame(record.value);
      await assertWorkflowResultBinding({
        result,
        threadId,
        manifest,
        breakpoint,
        snapshot,
        continuationCount,
        streamedEventHashes,
      });
      terminal = result;
      onFrame?.(result);
      continue;
    }

    const parsed = await validateStreamFrameRecord(path, record);
    const frame = parsed.frame;
    if (frame.type === "done") {
      throw new Error("Workflow stream used a Run done frame");
    }
    if (frame.type === "event") {
      if (snapshot) {
        throw new Error("Workflow stream emitted an event after snapshot");
      }
      if (lastEventSeq !== undefined && frame.event.seq !== lastEventSeq + 1) {
        throw new Error("Workflow event sequence is not contiguous");
      }
      lastEventSeq = frame.event.seq;
      if (frame.event.threadId !== threadId) {
        throw new Error("Workflow event Thread binding is invalid");
      }
      if (isExpectedContinuation(frame.event, breakpoint)) {
        continuationCount += 1;
      }
      streamedEventHashes.set(frame.event.seq, frame.eventSha256);
    } else if (frame.type === "snapshot") {
      if (snapshot) {
        throw new Error("Workflow stream emitted duplicate snapshots");
      }
      if (frame.detail.thread.id !== threadId) {
        throw new Error("Workflow snapshot Thread binding is invalid");
      }
      snapshot = frame;
    } else {
      if (frame.threadId !== threadId) {
        throw new Error("Workflow error Thread binding is invalid");
      }
      terminal = frame;
    }
    onFrame?.(frame);
  }

  if (!terminal) {
    throw new Error("Workflow stream ended without a terminal frame");
  }
  if (terminal.type === "error") {
    throw new Error(
      `Workflow continuation failed (${terminal.diagnosticSha256.slice(0, 12)})`,
    );
  }
  return terminal;
}

async function assertWorkflowResultBinding(input: {
  result: ExecutionPlanWorkflowResultFrame;
  threadId: string;
  manifest: ExecutionPlanWorkflowManifest;
  breakpoint: OpenWorkflowBreakpoint;
  snapshot: Extract<StreamFrame, { type: "snapshot" }>;
  continuationCount: number;
  streamedEventHashes: ReadonlyMap<number, string>;
}): Promise<void> {
  const { result, snapshot } = input;
  const snapshotPlan = snapshot.detail.plans.find(
    (plan) => plan.id === input.breakpoint.planId,
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
    result.threadId !== input.threadId ||
    result.planId !== input.breakpoint.planId ||
    result.manifestSha256 !== input.manifest.contentSha256 ||
    result.result.blueprintSha256 !== input.manifest.blueprint.contentSha256 ||
    result.snapshotSha256 !== snapshot.detailSha256 ||
    result.snapshotBytes !== snapshot.detailBytes ||
    result.eventCount !== snapshot.detail.thread.eventCount ||
    result.eventBytes !== snapshot.eventBytes ||
    input.continuationCount !== 1 ||
    snapshotPlan?.status !== expectedPlanStatus ||
    snapshot.detail.thread.status !== expectedThreadStatus
  ) {
    throw new Error("Workflow terminal binding is invalid");
  }
  if (
    result.status === "paused" &&
    !isExpectedReachedBreakpoint(
      snapshot.detail.events.find(
        (event) => event.seq === result.result.breakpoint?.reachedEventSeq,
      ),
      result.result.breakpoint,
      result.planId,
      result.manifestSha256,
    )
  ) {
    throw new Error("Workflow paused breakpoint evidence is invalid");
  }
  const manifestNodeIndex = new Map(
    input.manifest.nodes.map((node, index) => [node.id, index]),
  );
  const resultNodeIndexes = result.result.nodeResults.map((node) =>
    manifestNodeIndex.get(node.nodeId),
  );
  if (
    resultNodeIndexes.some((index) => index === undefined) ||
    resultNodeIndexes.some(
      (index, position) =>
        position > 0 &&
        Number(index) <= Number(resultNodeIndexes[position - 1]),
    ) ||
    (result.result.breakpoint !== undefined &&
      !manifestNodeIndex.has(result.result.breakpoint.nodeId))
  ) {
    throw new Error("Workflow result Manifest binding is invalid");
  }
  const snapshotEvents = new Map(
    snapshot.detail.events.map((event) => [event.seq, event]),
  );
  for (const [seq, expectedHash] of input.streamedEventHashes) {
    const event = snapshotEvents.get(seq);
    if (!event || (await sha256Text(JSON.stringify(event))) !== expectedHash) {
      throw new Error("Workflow snapshot changed a streamed event");
    }
  }
  const eventStreamSha256 = await sha256Text(
    snapshot.detail.events.map((event) => JSON.stringify(event)).join("\n"),
  );
  if (result.eventStreamSha256 !== eventStreamSha256) {
    throw new Error("Workflow event stream hash is invalid");
  }
}

function isExpectedReachedBreakpoint(
  event: RunEvent | undefined,
  breakpoint: ExecutionPlanWorkflowBreakpoint | undefined,
  planId: string,
  manifestSha256: string,
): boolean {
  if (!event || !breakpoint || event.type !== "workflow.breakpoint.reached") {
    return false;
  }
  const payload = record(event.payload);
  return (
    event.category === "plan" &&
    event.visibility === "user" &&
    payload?.["schemaVersion"] === 1 &&
    payload["planId"] === planId &&
    payload["manifestSha256"] === manifestSha256 &&
    payload["nodeId"] === breakpoint.nodeId &&
    payload["breakpointIndex"] === breakpoint.breakpointIndex &&
    payload["breakpointCount"] === breakpoint.breakpointCount &&
    payload["bindingContextSha256"] === breakpoint.bindingContextSha256
  );
}

function isExpectedContinuation(
  event: RunEvent,
  breakpoint: OpenWorkflowBreakpoint,
): boolean {
  if (event.type !== "workflow.breakpoint.continued") return false;
  const payload = record(event.payload);
  return (
    event.category === "plan" &&
    event.visibility === "user" &&
    payload?.["schemaVersion"] === 1 &&
    payload["planId"] === breakpoint.planId &&
    payload["manifestSha256"] === breakpoint.manifestSha256 &&
    payload["nodeId"] === breakpoint.nodeId &&
    payload["breakpointIndex"] === breakpoint.breakpointIndex &&
    payload["breakpointCount"] === breakpoint.breakpointCount &&
    payload["bindingContextSha256"] === breakpoint.bindingContextSha256 &&
    payload["planRevision"] === breakpoint.planRevision &&
    payload["reachedEventSeq"] === breakpoint.reachedEventSeq
  );
}

function expectHeader(headers: Headers, name: string, expected: string): void {
  if (headers.get(name) !== expected) {
    throw new Error(`Workflow response header is invalid: ${name}`);
  }
}

function expectHeaderIncludes(
  headers: Headers,
  name: string,
  expected: string,
): void {
  if (!headers.get(name)?.toLowerCase().includes(expected)) {
    throw new Error(`Workflow response header is invalid: ${name}`);
  }
}

function recordType(input: unknown): string | undefined {
  const value = record(input);
  return typeof value?.["type"] === "string" ? value["type"] : undefined;
}

function record(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}
