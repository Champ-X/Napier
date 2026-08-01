import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import type {
  LspRenameEdit,
  LspRenameFile,
} from "./lsp-rename-workspace-edit.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";
import { prepareSubagentWorktreeOwnerRoot } from "./subagent-worktree-storage.js";

export const MAX_SUBAGENT_WORKTREE_FILES = 2_000;
export const MAX_SUBAGENT_WORKTREE_BYTES = 32 * 1024 * 1024;
export const MAX_SUBAGENT_WORKTREE_FILE_BYTES = 1024 * 1024;
export const MAX_SUBAGENT_WORKTREE_WRITE_FILES = 8;

const TASK_ID = /^task_[a-z0-9]{8,80}$/u;
const GENERATED_DIRECTORIES = new Set([
  ".vite",
  "benchmark-results",
  "coverage",
  "dist",
  "playwright-report",
  "test-results",
]);

interface WorktreeFile {
  path: string;
  pathSha256: string;
  fileSha256: string;
  sizeBytes: number;
  buffer: Buffer;
}

interface WorktreeSnapshot {
  files: WorktreeFile[];
  fileCount: number;
  bytes: number;
  contentSha256: string;
}

export interface SubagentWorktreeSession {
  taskId: string;
  root: string;
  sourceRoot: string;
  sourceSnapshotSha256: string;
  sourceFileCount: number;
  sourceBytes: number;
  writePaths: string[];
  writeScopeSetSha256: string;
  baselineFiles: WorktreeFile[];
}

export interface SubagentWorktreeCandidate {
  files: LspRenameFile[];
  changedPaths: string[];
  changedFileSetSha256: string;
}

export async function createSubagentWorktree(input: {
  workspaceRoot: string;
  dataRoot: string;
  ownerId: string;
  taskId: string;
  writePaths: string[];
  signal?: AbortSignal;
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
    const baseline = await readWorktreeSnapshot(sourceRoot, input.signal);
    const baselineByPath = new Map(
      baseline.files.map((file) => [file.path, file]),
    );
    for (const writePath of writePaths) {
      const file = baselineByPath.get(writePath);
      if (!file) {
        throw new Error(
          "Subagent worktree write paths must name existing regular files",
        );
      }
      decodeUtf8(file.buffer, "Subagent worktree write target");
    }
    await copySnapshot(root, baseline, input.signal);
    const observed = await readWorktreeSnapshot(sourceRoot, input.signal);
    if (observed.contentSha256 !== baseline.contentSha256) {
      throw new Error(
        "Workspace changed while the Subagent worktree was forked",
      );
    }
    return {
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
      baselineFiles: writePaths.map(
        (candidate) => baselineByPath.get(candidate)!,
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
  const [candidate, source] = await Promise.all([
    readWorktreeSnapshot(session.root, signal),
    readWorktreeSnapshot(session.sourceRoot, signal),
  ]);
  if (source.contentSha256 !== session.sourceSnapshotSha256) {
    throw new Error("Workspace changed while the Subagent worktree was active");
  }
  const baseline = new Map(
    session.baselineFiles.map((file) => [file.path, file]),
  );
  const candidateByPath = new Map(
    candidate.files.map((file) => [file.path, file]),
  );
  const completeBaseline = await readWorktreeSnapshot(
    session.sourceRoot,
    signal,
  );
  if (completeBaseline.contentSha256 !== session.sourceSnapshotSha256) {
    throw new Error(
      "Workspace changed while the Subagent worktree was finalized",
    );
  }
  if (
    candidate.fileCount !== completeBaseline.fileCount ||
    candidate.files.some(
      (file) =>
        !completeBaseline.files.some(
          (sourceFile) => sourceFile.path === file.path,
        ),
    )
  ) {
    throw new Error("Subagent worktree added or removed an unauthorized file");
  }
  const changedPaths = candidate.files
    .filter((file) => {
      const sourceFile = completeBaseline.files.find(
        (entry) => entry.path === file.path,
      );
      return sourceFile?.fileSha256 !== file.fileSha256;
    })
    .map((file) => file.path)
    .sort();
  if (
    changedPaths.length < 1 ||
    changedPaths.some((changedPath) => !baseline.has(changedPath))
  ) {
    throw new Error(
      changedPaths.length < 1
        ? "Subagent worktree produced no declared file changes"
        : "Subagent worktree changed a file outside its declared write paths",
    );
  }
  const files = changedPaths.map((changedPath) => {
    const before = baseline.get(changedPath)!;
    const after = candidateByPath.get(changedPath)!;
    return fullFileEdit(before, after);
  });
  return {
    files,
    changedPaths,
    changedFileSetSha256: sha256(
      canonicalJson(
        files.map((file) => ({
          pathSha256: file.pathSha256,
          beforeSha256: file.fileSha256,
          afterSha256: sha256(file.edits[0]!.newText),
        })),
      ),
    ),
  };
}

export async function observeSubagentWorktreeSource(
  session: Pick<SubagentWorktreeSession, "sourceRoot" | "sourceSnapshotSha256">,
  signal?: AbortSignal,
): Promise<void> {
  const observed = await readWorktreeSnapshot(session.sourceRoot, signal);
  if (observed.contentSha256 !== session.sourceSnapshotSha256) {
    throw new Error("Subagent worktree merge conflicts with workspace drift");
  }
}

export async function removeSubagentWorktree(root: string): Promise<void> {
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
  const normalized = values.map(normalizeRelativePath);
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

function normalizeRelativePath(value: string): string {
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

async function readWorktreeSnapshot(
  root: string,
  signal?: AbortSignal,
): Promise<WorktreeSnapshot> {
  const files: WorktreeFile[] = [];
  let bytes = 0;
  const visit = async (directory: string): Promise<void> => {
    signal?.throwIfAborted();
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      signal?.throwIfAborted();
      if (
        isProtectedWorkspacePathSegment(child.name) ||
        GENERATED_DIRECTORIES.has(child.name.toLowerCase())
      ) {
        continue;
      }
      if (child.isSymbolicLink()) {
        throw new Error("Subagent worktree does not admit workspace symlinks");
      }
      const absolute = path.join(directory, child.name);
      if (child.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!child.isFile()) {
        throw new Error("Subagent worktree does not admit special files");
      }
      if (files.length >= MAX_SUBAGENT_WORKTREE_FILES) {
        throw new Error("Subagent worktree file limit exceeded");
      }
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const buffer = await readCanonicalFile(absolute);
      bytes += buffer.byteLength;
      if (bytes > MAX_SUBAGENT_WORKTREE_BYTES) {
        throw new Error("Subagent worktree byte limit exceeded");
      }
      files.push({
        path: relative,
        pathSha256: sha256(relative),
        fileSha256: sha256(buffer),
        sizeBytes: buffer.byteLength,
        buffer,
      });
    }
  };
  await visit(root);
  return {
    files,
    fileCount: files.length,
    bytes,
    contentSha256: sha256(
      canonicalJson(
        files.map((file) => ({
          pathSha256: file.pathSha256,
          fileSha256: file.fileSha256,
          sizeBytes: file.sizeBytes,
        })),
      ),
    ),
  };
}

async function readCanonicalFile(target: string): Promise<Buffer> {
  if ((await realpath(target)) !== target) {
    throw new Error("Subagent worktree source file is not canonical");
  }
  const handle = await open(
    target,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > MAX_SUBAGENT_WORKTREE_FILE_BYTES) {
      throw new Error("Subagent worktree source file exceeds its limit");
    }
    const buffer = await handle.readFile();
    const current = await lstat(target);
    if (
      buffer.byteLength > MAX_SUBAGENT_WORKTREE_FILE_BYTES ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      (await realpath(target)) !== target
    ) {
      throw new Error("Subagent worktree source file changed during capture");
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

async function copySnapshot(
  root: string,
  snapshot: WorktreeSnapshot,
  signal?: AbortSignal,
): Promise<void> {
  for (const file of snapshot.files) {
    signal?.throwIfAborted();
    const target = path.join(root, ...file.path.split("/"));
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const handle = await open(target, "wx", 0o600);
    try {
      await handle.writeFile(file.buffer);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

function fullFileEdit(
  before: WorktreeFile,
  after: WorktreeFile,
): LspRenameFile {
  const oldText = decodeUtf8(before.buffer, "Subagent worktree baseline");
  const newText = decodeUtf8(after.buffer, "Subagent worktree candidate");
  const lines = oldText.split("\n");
  const edit: LspRenameEdit = {
    path: before.path,
    pathSha256: before.pathSha256,
    fileSha256: before.fileSha256,
    startLine: 1,
    startCharacter: 1,
    endLine: lines.length,
    endCharacter: lines.at(-1)!.length + 1,
    rangeSha256: sha256(
      canonicalJson({
        startLine: 1,
        startCharacter: 1,
        endLine: lines.length,
        endCharacter: lines.at(-1)!.length + 1,
      }),
    ),
    oldText,
    oldTextSha256: sha256(oldText),
    newText,
    newTextSha256: sha256(newText),
  };
  return {
    path: before.path,
    pathSha256: before.pathSha256,
    fileSha256: before.fileSha256,
    edits: [edit],
  };
}

function decodeUtf8(buffer: Buffer, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${label} must be valid UTF-8`);
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}
