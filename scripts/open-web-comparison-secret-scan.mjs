import { createReadStream } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";

const MAX_STATE_SCAN_BYTES = 512 * 1024 * 1024;

export async function scanOpenWebComparisonSecrets(roots, secrets) {
  let bytes = 0;
  let fileCount = 0;
  const canonicalRoots = await Promise.all(roots.map((root) => realpath(root)));
  const needles = secrets.map((secret) => Buffer.from(secret));
  const visitedDirectories = new Set();
  const visitedFiles = new Set();
  const visit = async (root) => {
    const canonicalRoot = await realpath(root);
    if (!withinRoots(canonicalRoots, canonicalRoot)) {
      throw new Error("Comparison state symlink escapes the trial roots");
    }
    if (visitedDirectories.has(canonicalRoot)) return false;
    visitedDirectories.add(canonicalRoot);
    for (const entry of await readdir(canonicalRoot, {
      withFileTypes: true,
    })) {
      const target = path.join(canonicalRoot, entry.name);
      const canonicalTarget = entry.isSymbolicLink()
        ? await realpath(target).catch(() => {
            throw new Error("Comparison state contains a dangling symlink");
          })
        : target;
      if (!withinRoots(canonicalRoots, canonicalTarget)) {
        throw new Error("Comparison state symlink escapes the trial roots");
      }
      const info = await lstat(canonicalTarget);
      if (info.isDirectory()) {
        if (await visit(canonicalTarget)) return true;
        continue;
      }
      if (!info.isFile() || visitedFiles.has(canonicalTarget)) continue;
      visitedFiles.add(canonicalTarget);
      bytes += info.size;
      if (bytes > MAX_STATE_SCAN_BYTES) {
        throw new Error("Comparison state exceeds secret-scan budget");
      }
      fileCount += 1;
      if (await fileContainsNeedle(canonicalTarget, needles)) return true;
    }
    return false;
  };
  for (const root of canonicalRoots) {
    if (await visit(root)) {
      return { leakDetected: true, bytes, fileCount };
    }
  }
  return { leakDetected: false, bytes, fileCount };
}

async function fileContainsNeedle(filePath, needles) {
  const maximumNeedleBytes = Math.max(
    ...needles.map((needle) => needle.length),
  );
  let tail = Buffer.alloc(0);
  for await (const chunk of createReadStream(filePath)) {
    const body = tail.length > 0 ? Buffer.concat([tail, chunk]) : chunk;
    if (needles.some((needle) => body.includes(needle))) return true;
    tail =
      maximumNeedleBytes > 1
        ? body.subarray(Math.max(0, body.length - maximumNeedleBytes + 1))
        : Buffer.alloc(0);
  }
  return false;
}

function withinRoots(roots, candidate) {
  return roots.some((root) => {
    const relative = path.relative(root, candidate);
    return (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) &&
        relative !== ".." &&
        !path.isAbsolute(relative))
    );
  });
}
