import type { StreamFrame, ThreadStatus } from "@napier/contracts";

import {
  NapierStreamEventHashError,
  NapierStreamFrameContractError,
  NapierStreamFrameEventTypeError,
  NapierStreamFrameIdError,
  NapierStreamSnapshotHashError,
  sha256Text,
} from "./api-error";
import { isRunEventRecord } from "./run-event-contract";
import type { ParsedSseJsonRecord } from "./sse-json";

const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
const THREAD_STATUSES = new Set<ThreadStatus>([
  "idle",
  "running",
  "waiting",
  "failed",
]);
const THREAD_DETAIL_ARRAY_FIELDS = [
  "runs",
  "plans",
  "evaluations",
  "evaluationAdjudications",
  "evaluationReviewerBallots",
  "evaluationConsensusResolutions",
  "evaluationSuites",
  "evaluationSuiteExecutions",
  "automaticRecoveryAssessments",
  "automaticRecoveryAttempts",
  "subagents",
  "runControlMessages",
  "operatorDecisions",
] as const;
const SHA256 = /^[a-f0-9]{64}$/;

export interface ParsedStreamFrame {
  frame: StreamFrame;
  frameSha256: string;
}

export async function validateStreamFrameRecord(
  path: string,
  record: ParsedSseJsonRecord,
): Promise<ParsedStreamFrame> {
  const {
    value: frame,
    dataSha256: frameSha256,
    lineCount,
    eventType,
    id: sseId,
  } = record;
  const { isStreamFrame, streamFrameContractReason } =
    await import("./stream-frame-contract");
  if (!isStreamFrame(frame, STREAM_FRAME_HELPERS)) {
    const reason =
      streamFrameContractReason(frame, STREAM_FRAME_HELPERS) ?? "not_object";
    throw new NapierStreamFrameContractError(path, {
      frameSha256,
      lineCount,
      reason,
    });
  }
  if (eventType && eventType !== frame.type) {
    throw new NapierStreamFrameEventTypeError(path, {
      eventType,
      frameType: frame.type,
      frameSha256,
    });
  }
  await verifyEventHash(path, frame, frameSha256);
  await verifySnapshotHash(path, frame, frameSha256);
  verifyFrameId(path, frame, sseId, frameSha256);
  return { frame, frameSha256 };
}

async function verifyEventHash(
  path: string,
  frame: StreamFrame,
  frameSha256: string,
): Promise<void> {
  if (frame.type !== "event") return;
  const actualSha256 = await sha256Text(JSON.stringify(frame.event));
  if (actualSha256 === frame.eventSha256) return;
  throw new NapierStreamEventHashError(path, {
    expectedSha256: frame.eventSha256,
    actualSha256,
    frameSha256,
  });
}

async function verifySnapshotHash(
  path: string,
  frame: StreamFrame,
  frameSha256: string,
): Promise<void> {
  if (frame.type !== "snapshot") return;
  const actualSha256 = await sha256Text(JSON.stringify(frame.detail));
  if (actualSha256 === frame.detailSha256) return;
  throw new NapierStreamSnapshotHashError(path, {
    expectedSha256: frame.detailSha256,
    actualSha256,
    frameSha256,
  });
}

function verifyFrameId(
  path: string,
  frame: StreamFrame,
  sseId: string | undefined,
  frameSha256: string,
): void {
  const expectedId =
    frame.type === "event" ? String(frame.event.seq) : "absent";
  if (frame.type === "event") {
    if (sseId === expectedId) return;
    throw new NapierStreamFrameIdError(path, {
      frameType: frame.type,
      expectedId,
      ...(sseId !== undefined ? { actualId: sseId } : {}),
      frameSha256,
    });
  }
  if (sseId !== undefined) {
    throw new NapierStreamFrameIdError(path, {
      frameType: frame.type,
      expectedId,
      actualId: sseId,
      frameSha256,
    });
  }
}

const STREAM_FRAME_HELPERS = {
  snapshot: isSnapshotFrame,
  error: isErrorFrame,
  done: isDoneFrame,
};

function isDoneFrame(frame: Record<string, unknown>): boolean {
  return (
    typeof frame["threadId"] === "string" &&
    typeof frame["runId"] === "string" &&
    typeof frame["status"] === "string" &&
    TERMINAL_RUN_STATUSES.has(frame["status"]) &&
    typeof frame["snapshotSha256"] === "string" &&
    SHA256.test(frame["snapshotSha256"]) &&
    nonNegativeInteger(frame["snapshotBytes"]) &&
    nonNegativeInteger(frame["eventCount"]) &&
    nonNegativeInteger(frame["eventBytes"]) &&
    typeof frame["eventStreamSha256"] === "string" &&
    SHA256.test(frame["eventStreamSha256"])
  );
}

function isSnapshotFrame(frame: Record<string, unknown>): boolean {
  if (!validSnapshotEnvelope(frame)) return false;
  const detail = frame["detail"];
  if (!record(detail)) return false;
  const thread = detail["thread"];
  if (!validSnapshotThread(thread)) return false;
  const events = detail["events"];
  if (!Array.isArray(events)) return false;
  if (!validSnapshotDetail(frame, detail, thread, events)) return false;
  return (
    validRuns(detail, thread, thread["id"]) && validEvents(events, thread["id"])
  );
}

function validSnapshotEnvelope(frame: Record<string, unknown>): boolean {
  return (
    typeof frame["detailSha256"] === "string" &&
    SHA256.test(frame["detailSha256"]) &&
    nonNegativeInteger(frame["detailBytes"]) &&
    nonNegativeInteger(frame["eventBytes"])
  );
}

function validSnapshotThread(
  thread: unknown,
): thread is Record<string, unknown> & { id: string } {
  if (!record(thread)) return false;
  const threadId = thread["id"];
  const runIds = thread["runIds"];
  return (
    typeof threadId === "string" &&
    typeof thread["title"] === "string" &&
    typeof thread["agentId"] === "string" &&
    typeof thread["createdAt"] === "string" &&
    typeof thread["updatedAt"] === "string" &&
    typeof thread["lastMessage"] === "string" &&
    Array.isArray(runIds) &&
    runIds.every((runId) => typeof runId === "string") &&
    validThreadStatus(thread["status"])
  );
}

function validThreadStatus(status: unknown): boolean {
  return (
    typeof status === "string" && THREAD_STATUSES.has(status as ThreadStatus)
  );
}

function validSnapshotDetail(
  frame: Record<string, unknown>,
  detail: Record<string, unknown>,
  thread: Record<string, unknown>,
  events: unknown[],
): boolean {
  const eventCount = thread["eventCount"];
  const agent = detail["agent"];
  return (
    nonNegativeInteger(eventCount) &&
    events.length === eventCount &&
    frame["detailBytes"] === jsonByteLength(detail) &&
    frame["eventBytes"] === jsonByteLength(events) &&
    record(agent) &&
    agent["id"] === thread["agentId"] &&
    record(detail["contextCheckpointCalibration"]) &&
    THREAD_DETAIL_ARRAY_FIELDS.every((field) => Array.isArray(detail[field]))
  );
}

function validRuns(
  detail: Record<string, unknown>,
  thread: Record<string, unknown>,
  threadId: string,
): boolean {
  const runs = detail["runs"];
  const threadRunIds = thread["runIds"];
  if (
    !Array.isArray(runs) ||
    !Array.isArray(threadRunIds) ||
    threadRunIds.length !== runs.length
  ) {
    return false;
  }
  const runIds = new Set<string>();
  for (const run of runs) {
    if (!isRunRecordForThread(run, threadId, thread["agentId"])) return false;
    const runId = run["id"];
    if (typeof runId !== "string" || runIds.has(runId)) return false;
    runIds.add(runId);
  }
  if (
    threadRunIds.some(
      (runId) => typeof runId !== "string" || !runIds.has(runId),
    )
  ) {
    return false;
  }
  const currentRunId = thread["currentRunId"];
  return (
    currentRunId === undefined ||
    (typeof currentRunId === "string" && runIds.has(currentRunId))
  );
}

function validEvents(events: unknown[], threadId: string): boolean {
  let lastSeq = 0;
  for (const [index, event] of events.entries()) {
    if (!isRunEventRecord(event) || event.threadId !== threadId) return false;
    if (event.seq <= lastSeq || event.seq !== index + 1) return false;
    lastSeq = event.seq;
  }
  return true;
}

function isRunRecordForThread(
  run: unknown,
  threadId: string,
  agentId: unknown,
): run is Record<string, unknown> {
  return (
    record(run) &&
    typeof agentId === "string" &&
    typeof run["id"] === "string" &&
    run["threadId"] === threadId &&
    run["agentId"] === agentId &&
    typeof run["status"] === "string" &&
    (TERMINAL_RUN_STATUSES.has(run["status"]) ||
      run["status"] === "queued" ||
      run["status"] === "running") &&
    typeof run["startedAt"] === "string" &&
    (run["releaseIdentitySha256"] === undefined ||
      (typeof run["releaseIdentitySha256"] === "string" &&
        SHA256.test(run["releaseIdentitySha256"])))
  );
}

function isErrorFrame(frame: Record<string, unknown>): boolean {
  return (
    typeof frame["threadId"] === "string" &&
    typeof frame["message"] === "string" &&
    frame["code"] === "run_failed" &&
    typeof frame["diagnosticSha256"] === "string" &&
    SHA256.test(frame["diagnosticSha256"])
  );
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
