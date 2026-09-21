import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "./ed25519.js";

const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_TEST_FILES = 2_000;
const MAX_ENTRIES = 100_000;
const TEST_PATH =
  /(?:^|\/)(?:test|tests|__tests__)\/|(?:^|\/)[^/]+[.-](?:test|spec)\.[^/]+$/u;

/** Bound discovery by relevant source bytes, not unrelated workspace assets.
 * This is runner discovery only; verification separately binds the entire
 * workspace before and after execution. Links never silently narrow Node scope. */
export async function readVerificationTestSources(
  workspaceRoot: string,
  targets: string[],
) {
  const root = await realpath(workspaceRoot);
  const files = new Map<string, { hash: string; source: string }>();
  const visited = new Set<string>();
  let hasLinks = false;
  let incomplete = false;
  let bytes = 0;
  let entries = 0;
  const deadline = performance.now() + 30_000;
  const check = () => {
    if (++entries > MAX_ENTRIES || performance.now() >= deadline) {
      incomplete = true;
    }
  };
  const visit = async (absolute: string, explicit: boolean): Promise<void> => {
    check();
    if (incomplete) return;
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      hasLinks = true;
      return;
    }
    if (info.isDirectory()) {
      if (visited.has(absolute)) return;
      visited.add(absolute);
      for await (const child of await opendir(absolute)) {
        if ([".git", ".napier", "node_modules"].includes(child.name)) continue;
        await visit(path.join(absolute, child.name), false);
        if (incomplete) return;
      }
      return;
    }
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (files.has(absolute)) return;
    if (
      !/\.[cm]?[jt]sx?$/u.test(relative) ||
      /\.d\.[cm]?ts$/u.test(relative) ||
      (!explicit && !TEST_PATH.test(relative))
    )
      return;
    if (!info.isFile()) {
      incomplete = true;
      return;
    }
    if (files.size >= MAX_TEST_FILES || bytes + info.size > MAX_SOURCE_BYTES) {
      incomplete = true;
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    // Read at most the remaining budget plus one byte, even if a file grows
    // after lstat. A changing or capped read is not complete discovery.
    const handle = await open(
      absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stream = handle.createReadStream({
        end: MAX_SOURCE_BYTES - bytes,
        highWaterMark: 64 * 1024,
      });
      for await (const chunk of stream) {
        size += (chunk as Buffer).length;
        if (bytes + size > MAX_SOURCE_BYTES || performance.now() >= deadline) {
          incomplete = true;
          return;
        }
        chunks.push(chunk as Buffer);
      }
    } finally {
      await handle.close();
    }
    const after = await lstat(absolute);
    if (
      size !== info.size ||
      info.ino !== after.ino ||
      info.dev !== after.dev ||
      info.mtimeMs !== after.mtimeMs ||
      info.ctimeMs !== after.ctimeMs
    ) {
      throw new Error("Test runner selection source changed");
    }
    const content = Buffer.concat(chunks);
    bytes += size;
    files.set(absolute, {
      hash: sha256(content),
      source: content.toString("utf8"),
    });
  };
  for (const target of targets) {
    const canonical = await realpath(target);
    const relative = path.relative(root, canonical);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("Test runner selection scope escapes workspace");
    }
    await visit(canonical, true);
    if (incomplete) break;
  }
  return { files, hasLinks, incomplete };
}
