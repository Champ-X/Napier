import type {
  WorkspaceProcessDelta,
  WorkspaceProcessOutput,
  WorkspaceProcessOutputChunk,
  WorkspaceProcessSession,
} from "@napier/contracts";

import type { WorkspaceSnapshotDelta } from "./workspace-snapshot.js";

export interface ObservableWorkspaceProcess {
  session: WorkspaceProcessSession;
  privateProtocol: boolean;
  chunks: WorkspaceProcessOutputChunk[];
  nextCursor: number;
  workspaceDelta?: WorkspaceSnapshotDelta;
}

export function projectWorkspaceProcessOutput(input: {
  session: WorkspaceProcessSession;
  entry?: ObservableWorkspaceProcess;
  privateProtocolAccess: boolean;
  afterCursor: number;
  maximumChunks: number;
}): WorkspaceProcessOutput {
  const { entry, afterCursor } = input;
  if (entry && entry.privateProtocol !== input.privateProtocolAccess) {
    if (input.privateProtocolAccess) {
      throw new Error(
        "Workspace Process Session is not a private protocol session",
      );
    }
    return unavailableOutput(entry.session, afterCursor, entry.nextCursor);
  }
  if (!entry) {
    return unavailableOutput(
      input.session,
      afterCursor,
      input.session.nextCursor,
    );
  }
  const available = entry.chunks.filter((chunk) => chunk.cursor > afterCursor);
  const chunks = available.slice(0, input.maximumChunks);
  return {
    kind: "napier.workspace-process-output",
    schemaVersion: 1,
    processId: input.session.id,
    status: entry.session.status,
    afterCursor,
    nextCursor: chunks.at(-1)?.cursor ?? afterCursor,
    hasMore: available.length > chunks.length,
    outputAvailable: true,
    chunks: structuredClone(chunks),
  };
}

export function projectWorkspaceProcessDelta(
  session: WorkspaceProcessSession,
  delta?: WorkspaceSnapshotDelta,
): WorkspaceProcessDelta {
  if (!delta) {
    return {
      kind: "napier.workspace-process-delta",
      schemaVersion: 1,
      processId: session.id,
      ...(session.workspaceDeltaStatus
        ? { status: session.workspaceDeltaStatus }
        : {}),
      ...(session.workspaceWriteScopeStatus
        ? { writeScopeStatus: session.workspaceWriteScopeStatus }
        : {}),
      available: false,
      entriesTruncated: false,
      entries: [],
    };
  }
  return {
    kind: "napier.workspace-process-delta",
    schemaVersion: 1,
    processId: session.id,
    status: delta.status,
    ...(session.workspaceWriteScopeStatus
      ? { writeScopeStatus: session.workspaceWriteScopeStatus }
      : {}),
    available: true,
    entriesTruncated: delta.entriesTruncated,
    entries: structuredClone(delta.entries),
  };
}

function unavailableOutput(
  session: WorkspaceProcessSession,
  afterCursor: number,
  nextCursor: number,
): WorkspaceProcessOutput {
  return {
    kind: "napier.workspace-process-output",
    schemaVersion: 1,
    processId: session.id,
    status: session.status,
    afterCursor,
    nextCursor,
    hasMore: false,
    outputAvailable: false,
    chunks: [],
  };
}
