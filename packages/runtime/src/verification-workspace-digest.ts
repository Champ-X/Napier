import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, opendir, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { WorkspaceSnapshotEntry } from "./workspace-snapshot.js";

export interface VerificationWorkspaceDigest {
  sha256: string;
  fileCount: number;
  bytes: number;
  truncated: boolean;
}

/** Same ordered entry encoding as a complete directory snapshot, without
 * retaining entries or buffering whole files. Listing/context limits must not
 * become a repository-size limit for verification. Incomplete reads fail closed.
 * Like the existing snapshots, this is optimistic observation, not a file lock. */
export async function digestVerificationWorkspace(
  root: string,
  options: {
    maxEntries?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<VerificationWorkspaceDigest> {
  const maxEntries = options.maxEntries ?? 100_000;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1
  ) {
    throw new Error("verification workspace digest limits are invalid");
  }
  const deadline = performance.now() + timeoutMs;
  const canonicalRoot = await realpath(root);
  const digest = createHash("sha256").update("[");
  const buffer = Buffer.alloc(64 * 1024);
  let entryCount = 0;
  let fileCount = 0;
  let bytes = 0;
  let truncated = false;
  const check = () => {
    options.signal?.throwIfAborted();
    if (performance.now() >= deadline) throw new Error("digest deadline");
  };
  const append = (entry: WorkspaceSnapshotEntry) => {
    check();
    if (entryCount >= maxEntries) throw new Error("digest entry limit");
    if (entryCount > 0) digest.update(",");
    digest.update(canonicalJson(entry));
    entryCount += 1;
    bytes += entry.sizeBytes;
  };
  const visit = async (directory: string): Promise<void> => {
    check();
    const before = await lstat(directory);
    if (!before.isDirectory()) throw new Error("digest directory changed");
    const names: string[] = [];
    for await (const child of await opendir(directory)) {
      check();
      if ([".git", ".napier", "node_modules"].includes(child.name)) continue;
      if (names.length + entryCount >= maxEntries) {
        throw new Error("digest entry limit");
      }
      names.push(child.name);
    }
    names.sort();
    for (const name of names) {
      check();
      const absolute = path.join(directory, name);
      const relative = path.relative(canonicalRoot, absolute);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        const target = await readlink(absolute);
        if (!sameObservation(info, await lstat(absolute))) {
          throw new Error("digest link changed");
        }
        append({
          path: relative,
          entryKind: "symlink",
          sizeBytes: Buffer.byteLength(target),
          sha256: sha256(target),
        });
      } else if (info.isDirectory()) {
        append({ path: relative, entryKind: "directory", sizeBytes: 0 });
        await visit(absolute);
      } else if (info.isFile()) {
        const handle = await open(
          absolute,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          if (!sameObservation(info, await handle.stat()))
            throw new Error("digest file changed");
          const hash = createHash("sha256");
          let observedBytes = 0;
          while (true) {
            check();
            const read = await handle.read(buffer, 0, buffer.length, null);
            if (read.bytesRead === 0) break;
            observedBytes += read.bytesRead;
            hash.update(buffer.subarray(0, read.bytesRead));
          }
          if (
            observedBytes !== info.size ||
            !sameObservation(info, await handle.stat()) ||
            !sameObservation(info, await lstat(absolute))
          ) {
            throw new Error("digest file changed");
          }
          append({
            path: relative,
            entryKind: "file",
            sha256: hash.digest("hex"),
            sizeBytes: observedBytes,
          });
          fileCount += 1;
        } finally {
          await handle.close();
        }
      } else {
        throw new Error("digest unsupported entry");
      }
    }
    if (!sameObservation(before, await lstat(directory))) {
      throw new Error("digest directory changed");
    }
  };
  try {
    await visit(canonicalRoot);
    check();
  } catch {
    options.signal?.throwIfAborted();
    truncated = true;
  }
  return {
    sha256: digest.update("]").digest("hex"),
    fileCount,
    bytes,
    truncated,
  };
}

function sameObservation(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}
