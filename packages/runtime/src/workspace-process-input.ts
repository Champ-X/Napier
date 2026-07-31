import type { Hash } from "node:crypto";
import type { Writable } from "node:stream";

import type {
  WorkspaceProcessInputReceipt,
  WorkspaceProcessSession,
} from "@napier/contracts";

import { sha256 } from "./ed25519.js";
import { createId, nowIso } from "./ids.js";
import {
  createWorkspaceProcessInputReceipt,
  createWorkspaceProcessSession,
} from "./workspace-process-events.js";

export const MAX_WORKSPACE_PROCESS_INPUT_BYTES = 32 * 1024;
export const MAX_WORKSPACE_PROCESS_TOTAL_INPUT_BYTES = 256 * 1024;
export const MAX_WORKSPACE_PROCESS_INPUT_WRITES = 64;

export interface WorkspaceProcessInput {
  text: string;
  appendNewline?: boolean;
  close?: boolean;
  initiatedBy: WorkspaceProcessInputReceipt["initiatedBy"];
}

export interface WorkspaceProcessInputResult {
  session: WorkspaceProcessSession;
  receipt: WorkspaceProcessInputReceipt;
}

export async function writeWorkspaceProcessInput(
  session: WorkspaceProcessSession,
  stream: Writable,
  cumulativeHash: Hash,
  request: WorkspaceProcessInput,
): Promise<WorkspaceProcessInputResult> {
  if (
    session.status !== "running" ||
    session.schemaVersion < 3 ||
    session.stdinMode !== "interactive" ||
    session.stdinOpen !== true
  ) {
    throw new Error("Workspace Process stdin is not open");
  }
  if (
    session.schemaVersion === 4 &&
    session.ioMode === "pty" &&
    request.close
  ) {
    throw new Error(
      "PTY input cannot use pipe close semantics; send an explicit terminal control byte or cancel the session",
    );
  }
  if (Buffer.from(request.text, "utf8").toString("utf8") !== request.text) {
    throw new Error("Workspace Process input must be valid UTF-8 text");
  }
  const input = Buffer.from(
    `${request.text}${request.appendNewline ? "\n" : ""}`,
    "utf8",
  );
  if (input.byteLength === 0 && request.close !== true) {
    throw new Error("Workspace Process input is empty");
  }
  if (input.byteLength > MAX_WORKSPACE_PROCESS_INPUT_BYTES) {
    throw new Error("Workspace Process input exceeds its message limit");
  }
  const nextWriteCount = (session.stdinWriteCount ?? 0) + 1;
  if (nextWriteCount > MAX_WORKSPACE_PROCESS_INPUT_WRITES) {
    throw new Error("Workspace Process input exceeds its write-count limit");
  }
  const nextInputBytes = (session.stdinBytes ?? 0) + input.byteLength;
  if (nextInputBytes > MAX_WORKSPACE_PROCESS_TOTAL_INPUT_BYTES) {
    throw new Error("Workspace Process input exceeds its total-byte limit");
  }

  await writeInput(stream, input, request.close === true);
  if (input.byteLength > 0) cumulativeHash.update(input);
  const stdinSha256 = cumulativeHash.copy().digest("hex");
  const {
    kind: _kind,
    schemaVersion: _schemaVersion,
    outputAvailable: _outputAvailable,
    workspaceDeltaAvailable: _workspaceDeltaAvailable,
    contentSha256: _contentSha256,
    ...sessionInput
  } = session;
  const updated = createWorkspaceProcessSession({
    ...sessionInput,
    schemaVersion: session.schemaVersion,
    stdinOpen: request.close !== true,
    stdinWriteCount: nextWriteCount,
    stdinBytes: nextInputBytes,
    stdinSha256,
  });
  return {
    session: updated,
    receipt: createWorkspaceProcessInputReceipt({
      id: createId("processinput"),
      threadId: updated.threadId,
      runId: updated.runId,
      processId: updated.id,
      initiatedBy: request.initiatedBy,
      sequence: nextWriteCount,
      inputBytes: input.byteLength,
      inputSha256: sha256(input),
      totalInputBytes: nextInputBytes,
      cumulativeInputSha256: stdinSha256,
      stdinClosed: request.close === true,
      writtenAt: nowIso(),
      sessionSha256: updated.contentSha256,
    }),
  };
}

async function writeInput(
  stream: Writable,
  input: Buffer,
  close: boolean,
): Promise<void> {
  if (stream.destroyed || stream.writableEnded || !stream.writable) {
    throw new Error("Workspace Process stdin is not open");
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error | null): void => {
      if (settled) return;
      settled = true;
      stream.off("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onError = (error: Error): void => finish(error);
    stream.once("error", onError);
    if (close) {
      stream.end(input, () => finish());
    } else {
      stream.write(input, (error) => finish(error));
    }
  });
}
