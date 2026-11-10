import type {
  RunEvent,
  RunStatus,
  StreamFrame,
  SubagentTask,
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
  projections?: NonNullable<
    Extract<StreamFrame, { type: "event" }>["projections"]
  >,
): Extract<StreamFrame, { type: "event" }> {
  return {
    type: "event",
    event,
    eventSha256: sha256(JSON.stringify(event)),
    ...(projections ? { projections } : {}),
  };
}

export function streamSnapshotFrame(
  detail: ThreadDetail,
): Extract<StreamFrame, { type: "snapshot" }> {
  detail = {
    ...detail,
    subagents: detail.subagents.map(projectPublicSubagentTask),
  };
  const serializedDetail = JSON.stringify(detail);
  return {
    type: "snapshot",
    detail,
    detailSha256: sha256(serializedDetail),
    detailBytes: Buffer.byteLength(serializedDetail, "utf8"),
    eventBytes: jsonByteLength(detail.events),
  };
}

/** Private completion records carry candidate capabilities for recovery/replay. */
function projectPublicSubagentTask({
  writePaths: _writePaths,
  completionReservation: _completionReservation,
  completion: _completion,
  ...task
}: SubagentTask): SubagentTask {
  return task;
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
