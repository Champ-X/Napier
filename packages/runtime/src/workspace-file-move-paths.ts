import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256 } from "./ed25519.js";
import { MAX_WORKSPACE_FILE_MUTATION_BYTES, normalizeMutationPath } from "./workspace-file-scope.js";

export interface MovePathIdentity { dev: number; ino: number }
export interface MoveFileIdentity extends MovePathIdentity { bytes: number; sha256: string }
export interface MovePathBinding {
  workspaceRootSha256: string;
  root: MovePathIdentity;
  sourcePath: string;
  destinationPath: string;
  sourceParent: MovePathIdentity;
  destinationParent: MovePathIdentity;
  file: MoveFileIdentity;
}

export async function inspectMovePaths(workspaceRoot: string, sourcePath: string,
  destinationPath: string): Promise<MovePathBinding> {
  const root = await realpath(workspaceRoot);
  const source = await safeTarget(root, sourcePath), destination = await safeTarget(root, destinationPath);
  if (source === destination || !(await absent(destination))) throw new Error("move_destination_occupied");
  const file = await fileIdentity(source);
  const sourceParent = await directoryIdentity(path.dirname(source));
  const destinationParent = await directoryIdentity(path.dirname(destination));
  if (file.dev !== destinationParent.dev) throw new Error("move_cross_device");
  return { workspaceRootSha256: sha256(root), root: await directoryIdentity(root), sourcePath, destinationPath,
    sourceParent, destinationParent, file };
}

export async function matchesMoveState(workspaceRoot: string, binding: MovePathBinding,
  state: "before" | "after"): Promise<boolean> {
  try {
    const root = await realpath(workspaceRoot);
    if (sha256(root) !== binding.workspaceRootSha256 || !same(await directoryIdentity(root), binding.root)) return false;
    const source = await safeTarget(root, binding.sourcePath), destination = await safeTarget(root, binding.destinationPath);
    if (!same(await directoryIdentity(path.dirname(source)), binding.sourceParent) ||
        !same(await directoryIdentity(path.dirname(destination)), binding.destinationParent)) return false;
    const target = state === "before" ? source : destination;
    const missing = state === "before" ? destination : source;
    return await absent(missing) && same(await fileIdentity(target), binding.file);
  } catch { return false; }
}

async function safeTarget(root: string, relative: string): Promise<string> {
  if (normalizeMutationPath(relative) !== relative) throw new Error("move_path_not_canonical");
  const parts = relative.split(path.sep);
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(cursor) !== cursor)
      throw new Error("move_parent_changed");
  }
  return path.join(root, relative);
}

async function directoryIdentity(target: string): Promise<MovePathIdentity> {
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(target) !== target)
    throw new Error("move_parent_changed");
  return { dev: info.dev, ino: info.ino };
}

async function fileIdentity(target: string): Promise<MoveFileIdentity> {
  // NONBLOCK lets the fd type check reject a raced FIFO without waiting for a writer.
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_WORKSPACE_FILE_MUTATION_BYTES) throw new Error("move_file_scope_unsupported");
    const buffer = Buffer.alloc(before.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const read = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!read.bytesRead) break;
      bytesRead += read.bytesRead;
    }
    const bytes = buffer.subarray(0, bytesRead);
    const after = await handle.stat(), current = await lstat(target);
    if (before.size !== bytes.length || after.size !== before.size || before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs || current.isSymbolicLink() || current.dev !== before.dev ||
        current.ino !== before.ino || await realpath(target) !== target) throw new Error("move_file_changed");
    return { dev: before.dev, ino: before.ino, bytes: bytes.length, sha256: sha256(bytes) };
  } finally { await handle.close(); }
}

async function absent(target: string): Promise<boolean> {
  try { await lstat(target); return false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; }
}
function same(left: object, right: object): boolean { return canonicalJson(left) === canonicalJson(right); }
