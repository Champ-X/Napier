import path from "node:path";

import type {
  WorkspaceProcessSession,
  WorkspaceProcessStatus,
  WorkspaceProcessWriteScopeStatus,
} from "@napier/contracts";

import {
  assertCommandRuntimeStable,
  type PreparedCommandExecution,
} from "./command-execution.js";
import { nowIso } from "./ids.js";
import {
  createWorkspaceProcessSession,
  workspaceProcessStableSessionInput,
} from "./workspace-process-events.js";
import {
  createWorkspacePathSnapshot,
  diffWorkspaceSnapshots,
  type WorkspacePathSnapshot,
  type WorkspaceSnapshotDelta,
  unavailableWorkspacePathSnapshot,
} from "./workspace-snapshot.js";
import { createWorkspaceProcessWriteSnapshot } from "./workspace-process-write-snapshot.js";

export interface WorkspaceProcessWorkspaceSettlement {
  afterSnapshot: WorkspacePathSnapshot;
  workspaceDelta: WorkspaceSnapshotDelta;
  writeScopeStatus?: WorkspaceProcessWriteScopeStatus;
}

export async function settleWorkspaceProcessExecution(input: {
  session: WorkspaceProcessSession;
  prepared: PreparedCommandExecution;
  beforeSnapshot: WorkspacePathSnapshot;
  relativeWritePaths?: string[];
  forcedStatus?: WorkspaceProcessStatus;
  interruptionReason?: string;
  exit: { code: number | null; signal: NodeJS.Signals | null };
  stdoutChars: number;
  stderrChars: number;
  stdoutSha256: string;
  stderrSha256: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  nextCursor: number;
}): Promise<{
  session: WorkspaceProcessSession;
  workspaceDelta: WorkspaceSnapshotDelta;
}> {
  let status =
    input.forcedStatus ??
    (input.exit.code === 0 ? ("succeeded" as const) : ("failed" as const));
  let interruptionReason = input.interruptionReason;
  try {
    await assertCommandRuntimeStable(input.prepared);
  } catch {
    status = "failed";
    interruptionReason = "The bound command runtime changed during execution.";
  }
  const { afterSnapshot, workspaceDelta, writeScopeStatus } =
    await settleWorkspaceProcessWorkspace({
      workspaceRoot: input.prepared.workspaceRoot,
      beforeSnapshot: input.beforeSnapshot,
      ...(input.relativeWritePaths
        ? { relativeWritePaths: input.relativeWritePaths }
        : {}),
    });
  if (writeScopeStatus === "outside_scope" && !interruptionReason) {
    interruptionReason =
      "Workspace changes were observed outside the approved write scope; attribution is unknown.";
  } else if (writeScopeStatus === "indeterminate" && !interruptionReason) {
    interruptionReason =
      "The scoped workspace write could not be completely verified.";
  }
  const settledAt = nowIso();
  return {
    workspaceDelta,
    session: createWorkspaceProcessSession({
      ...workspaceProcessStableSessionInput(input.session),
      schemaVersion: input.session.schemaVersion,
      status,
      ...(input.session.schemaVersion >= 3 ? { stdinOpen: false } : {}),
      settledAt,
      durationMs: Math.max(
        0,
        Date.parse(settledAt) - Date.parse(input.session.startedAt),
      ),
      exitCode: input.exit.code,
      signal: input.exit.signal,
      stdoutChars: input.stdoutChars,
      stderrChars: input.stderrChars,
      stdoutSha256: input.stdoutSha256,
      stderrSha256: input.stderrSha256,
      stdoutTruncated: input.stdoutTruncated,
      stderrTruncated: input.stderrTruncated,
      nextCursor: input.nextCursor,
      workspaceAfterSha256: afterSnapshot.sha256,
      workspaceAfterTruncated: afterSnapshot.truncated,
      workspaceDeltaStatus: workspaceDelta.status,
      workspaceChangedFileCount: workspaceDelta.changedFileCount,
      workspaceChangedPathSetSha256: workspaceDelta.changedPathSetSha256,
      ...(writeScopeStatus
        ? { workspaceWriteScopeStatus: writeScopeStatus }
        : {}),
      ...(interruptionReason ? { interruptionReason } : {}),
    }),
  };
}

export async function settleWorkspaceProcessWorkspace(input: {
  workspaceRoot: string;
  beforeSnapshot: WorkspacePathSnapshot;
  relativeWritePaths?: string[];
}): Promise<WorkspaceProcessWorkspaceSettlement> {
  const afterSnapshot = await (
    input.relativeWritePaths
      ? createWorkspaceProcessWriteSnapshot(input.workspaceRoot)
      : createWorkspacePathSnapshot(input.workspaceRoot, input.workspaceRoot)
  ).catch(() => unavailableWorkspacePathSnapshot(input.beforeSnapshot.kind));
  const workspaceDelta = diffWorkspaceSnapshots(
    input.beforeSnapshot,
    afterSnapshot,
  );
  return {
    afterSnapshot,
    workspaceDelta,
    ...(input.relativeWritePaths
      ? {
          writeScopeStatus: classifyWriteScope(
            workspaceDelta,
            input.relativeWritePaths,
          ),
        }
      : {}),
  };
}

function classifyWriteScope(
  delta: WorkspaceSnapshotDelta,
  writePaths: string[],
): WorkspaceProcessWriteScopeStatus {
  if (delta.status === "indeterminate" || delta.entriesTruncated) {
    return "indeterminate";
  }
  return delta.entries.every((entry) =>
    writePaths.some((writePath) => inside(entry.path, writePath)),
  )
    ? "within_scope"
    : "outside_scope";
}

function inside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
