import path from "node:path";

import type { WorkspaceProcessWriteScopeStatus } from "@napier/contracts";

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
