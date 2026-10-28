import { mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  createSubagentWorktreeCandidate,
  type SubagentWorktreeCandidate,
  type SubagentWorktreeSnapshot,
} from "./subagent-worktree-diff.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";
import { prepareSubagentWorktreeOwnerRoot } from "./subagent-worktree-storage.js";

import {
  readWorktreeBaseline,
  removeWorktreeBaseline,
  saveWorktreeBaseline,
} from "./subagent-worktree-baseline.js";
import { SUBAGENT_WORKTREE_POLICY as policy } from "./subagent-worktree-policy.js";
import {
  errorCode,
  GENERATED_WORKTREE_DIRECTORIES as GENERATED_DIRECTORIES,
  readWorktreeSnapshot,
  type SubagentWorktreeSession,
} from "./subagent-worktree-snapshot.js";

export const MAX_SUBAGENT_WORKTREE_FILES = policy.maxFiles;
export const MAX_SUBAGENT_WORKTREE_BYTES = policy.maxSourceBytes;
export const MAX_SUBAGENT_WORKTREE_FILE_BYTES = policy.maxWriteFileBytes;
export const MAX_SUBAGENT_WORKTREE_WRITE_FILES = policy.maxWriteFiles;
const TASK_ID = /^task_[a-z0-9]{8,80}$/u;

export type { SubagentWorktreeSession } from "./subagent-worktree-snapshot.js";

export type {
  SubagentWorktreeCandidate,
  SubagentWorktreeFile,
  SubagentWorktreeSnapshot,
} from "./subagent-worktree-diff.js";

export async function createSubagentWorktree(input: {
  workspaceRoot: string;
  dataRoot: string;
  ownerId: string;
  taskId: string;
  writePaths: string[];
  signal?: AbortSignal;
  forceCopy?: boolean;
}): Promise<SubagentWorktreeSession> {
  if (!TASK_ID.test(input.taskId)) {
    throw new Error("Subagent worktree task ID is invalid");
  }
  const writePaths = normalizeWritePaths(input.writePaths);
  const sourceRoot = await realpath(path.resolve(input.workspaceRoot));
  const ownerRoot = await prepareSubagentWorktreeOwnerRoot(input);
  const root = path.join(ownerRoot, input.taskId);
  await mkdir(root, { mode: 0o700 });
  try {
    input.signal?.throwIfAborted();
    const copyReceipt = { clonedFiles: 0, copiedFiles: 0 };
    const baseline = await readWorktreeSnapshot(sourceRoot, {
      ...(input.signal ? { signal: input.signal } : {}),
      retainPaths: new Set(writePaths),
      copyTo: root,
      copyReceipt,
      ...(input.forceCopy ? { forceCopy: true } : {}),
    });
    const baselineByPath = new Map(
      baseline.files.map((file) => [file.path, file]),
    );
    for (const writePath of writePaths) {
      const file = baselineByPath.get(writePath);
      if (file) decodeUtf8(file.buffer!, "Subagent worktree write target");
    }
    const observed = await readWorktreeSnapshot(sourceRoot, {
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (observed.contentSha256 !== baseline.contentSha256) {
      throw new Error(
        "Workspace changed while the Subagent worktree was forked",
      );
    }
    return {
      baselineSha256: await saveWorktreeBaseline(root, baseline),
      copyReceipt,
      readScopes: [],
      taskId: input.taskId,
      root,
      sourceRoot,
      sourceSnapshotSha256: baseline.contentSha256,
      sourceFileCount: baseline.fileCount,
      sourceBytes: baseline.bytes,
      writePaths,
      writeScopeSetSha256: sha256(
        canonicalJson(writePaths.map((candidate) => sha256(candidate))),
      ),
    };
  } catch (error) {
    await removeSubagentWorktree(root);
    throw error;
  }
}

export async function finalizeSubagentWorktree(
  session: SubagentWorktreeSession,
  signal?: AbortSignal,
): Promise<SubagentWorktreeCandidate> {
  signal?.throwIfAborted();
  const [candidate, completeBaseline] = await Promise.all([
    readWorktreeSnapshot(session.root, {
      ...(signal ? { signal } : {}),
      retainPaths: new Set(session.writePaths),
    }),
    readWorktreeBaseline(session),
  ]);
  return createSubagentWorktreeCandidate({
    baseline: completeBaseline,
    candidate,
    writePaths: session.writePaths,
  });
}

export async function observeSubagentWorktreeCandidate(
  session: Pick<SubagentWorktreeSession, "root">,
  signal?: AbortSignal,
): Promise<SubagentWorktreeSnapshot> {
  return readWorktreeSnapshot(session.root, { ...(signal ? { signal } : {}) });
}

export async function observeSubagentWorktreeSource(
  session: Pick<SubagentWorktreeSession, "sourceRoot" | "sourceSnapshotSha256">,
  signal?: AbortSignal,
): Promise<void> {
  const observed = await readWorktreeSnapshot(session.sourceRoot, {
    ...(signal ? { signal } : {}),
  });
  if (observed.contentSha256 !== session.sourceSnapshotSha256) {
    throw new Error("Subagent worktree merge conflicts with workspace drift");
  }
}

export async function removeSubagentWorktree(root: string): Promise<void> {
  await removeWorktreeBaseline(root);
  await rm(root, { recursive: true, force: false }).catch((error) => {
    if (errorCode(error) !== "ENOENT") throw error;
  });
}

function normalizeWritePaths(values: string[]): string[] {
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > MAX_SUBAGENT_WORKTREE_WRITE_FILES
  ) {
    throw new Error(
      `Subagent worktree requires 1-${MAX_SUBAGENT_WORKTREE_WRITE_FILES} write paths`,
    );
  }
  const normalized = values.map(normalizeSubagentWorktreePath);
  const identities = new Set(
    normalized.map((candidate) =>
      process.platform === "darwin" || process.platform === "win32"
        ? candidate.toLowerCase()
        : candidate,
    ),
  );
  if (identities.size !== normalized.length) {
    throw new Error("Subagent worktree write paths must be unique");
  }
  return normalized.sort();
}

export function normalizeSubagentWorktreePath(value: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 500 ||
    path.isAbsolute(value) ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error("Subagent worktree path must be workspace-relative");
  }
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        isProtectedWorkspacePathSegment(segment) ||
        GENERATED_DIRECTORIES.has(segment.toLowerCase()),
    )
  ) {
    throw new Error("Subagent worktree path targets an unavailable scope");
  }
  return segments.join("/");
}

function decodeUtf8(buffer: Buffer, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${label} must be valid UTF-8`);
  }
}
