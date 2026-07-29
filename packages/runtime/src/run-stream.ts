import type {
  RunEvent,
  RunStatus,
  StreamFrame,
  TerminalRunStatus,
  ThreadDetail,
} from "@napier/contracts";

import { sha256 } from "./ed25519.js";

export const RUN_STREAM_ERROR_MESSAGE = "Run failed while streaming.";
export const RUN_STREAM_ERROR_CODE = "run_failed";

export function streamRunErrorFrame(
  threadId: string,
  error: unknown,
): Extract<StreamFrame, { type: "error" }> {
  return {
    type: "error",
    threadId,
    message: RUN_STREAM_ERROR_MESSAGE,
    code: RUN_STREAM_ERROR_CODE,
    diagnosticSha256: sha256(errorMessage(error)),
  };
}

export function streamEventFrame(
  event: RunEvent,
): Extract<StreamFrame, { type: "event" }> {
  return {
    type: "event",
    event,
    eventSha256: sha256(JSON.stringify(event)),
  };
}

export function streamSnapshotFrame(
  detail: ThreadDetail,
): Extract<StreamFrame, { type: "snapshot" }> {
  const serializedDetail = JSON.stringify(detail);
  return {
    type: "snapshot",
    detail,
    detailSha256: sha256(serializedDetail),
    detailBytes: Buffer.byteLength(serializedDetail, "utf8"),
    eventBytes: jsonByteLength(detail.events),
  };
}

export function streamRunDoneFrame(
  threadId: string,
  runId: string,
  status: RunStatus,
  snapshotSha256: string,
  snapshotBytes: number,
  eventCount: number,
  eventBytes: number,
  eventStreamSha256: string,
): Extract<StreamFrame, { type: "done" }> {
  return {
    type: "done",
    threadId,
    runId,
    status: terminalRunStatus(status),
    snapshotSha256,
    snapshotBytes,
    eventCount,
    eventBytes,
    eventStreamSha256,
  };
}

function terminalRunStatus(status: RunStatus): TerminalRunStatus {
  switch (status) {
    case "completed":
    case "failed":
    case "cancelled":
    case "interrupted":
      return status;
    case "queued":
    case "running":
      throw new Error(
        `Run stream cannot finish with non-terminal status: ${status}`,
      );
  }
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
