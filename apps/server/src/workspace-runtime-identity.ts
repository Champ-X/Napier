import { createHash } from "node:crypto";
import { mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { resolveRebindWorkspaceRoot } from "./workspace-rebind.js";

export interface WorkspaceRuntimeIdentity {
  workspaceId: string;
  root: string;
  dataRoot: string;
}

export function workspaceRuntimeId(root: string, dataRoot: string): string {
  return `workspace_${createHash("sha256")
    .update(JSON.stringify(["napier.workspace.v1", root, dataRoot]))
    .digest("hex")}`;
}

export function validWorkspaceRuntimeId(value: string): boolean {
  return /^workspace_[a-f0-9]{64}$/u.test(value);
}

/** Identity includes the ledger location: copied thread IDs are not identities. */
export async function resolveWorkspaceRuntimeIdentity(
  requestedRoot: string,
  requestedDataRoot?: string,
): Promise<WorkspaceRuntimeIdentity> {
  const root = await resolveRebindWorkspaceRoot(requestedRoot);
  const target = requestedDataRoot ?? path.join(root, ".napier");
  if (!path.isAbsolute(target)) throw new Error("Workspace data root must be absolute");
  await mkdir(target, { recursive: true, mode: 0o700 });
  const dataRoot = await realpath(target);
  if (!(await stat(dataRoot)).isDirectory()) {
    throw new Error("Workspace data root must be a directory");
  }
  return { workspaceId: workspaceRuntimeId(root, dataRoot), root, dataRoot };
}

/** A missing or retargeted location must not silently become an empty ledger. */
export async function verifyWorkspaceRuntimeIdentity(
  identity: WorkspaceRuntimeIdentity,
): Promise<void> {
  const [root, dataRoot] = await Promise.all([
    realpath(identity.root), realpath(identity.dataRoot),
  ]);
  if (root !== identity.root || dataRoot !== identity.dataRoot ||
      workspaceRuntimeId(root, dataRoot) !== identity.workspaceId) {
    throw new Error("Workspace runtime identity changed");
  }
  const info = await Promise.all([stat(root), stat(dataRoot)]);
  if (info.some((entry) => !entry.isDirectory())) {
    throw new Error("Workspace runtime location is not a directory");
  }
}
