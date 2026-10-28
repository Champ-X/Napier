import { constants } from "node:fs";
import { lstat, open, realpath, rm } from "node:fs/promises";
import { sha256 } from "./ed25519.js";
import type {
  SubagentWorktreeFile,
  SubagentWorktreeSnapshot,
} from "./subagent-worktree-diff.js";
import { worktreeSnapshotHash } from "./subagent-worktree-snapshot.js";

const MAX_BASELINE_BYTES = 64 * 1024 * 1024;

export async function saveWorktreeBaseline(
  root: string,
  snapshot: SubagentWorktreeSnapshot,
): Promise<string> {
  const serialized = JSON.stringify({
    ...snapshot,
    files: snapshot.files.map(({ buffer, ...file }) => ({
      ...file,
      ...(buffer ? { content: buffer.toString("base64") } : {}),
    })),
  });
  if (Buffer.byteLength(serialized) > MAX_BASELINE_BYTES)
    throw new Error("Subagent baseline storage limit exceeded");
  const handle = await open(`${root}.baseline.json`, "wx", 0o600);
  try {
    await handle.writeFile(serialized);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return sha256(serialized);
}

export async function readWorktreeBaseline(session: {
  root: string;
  baselineSha256: string;
  sourceSnapshotSha256: string;
}): Promise<SubagentWorktreeSnapshot> {
  const target = `${session.root}.baseline.json`;
  if ((await realpath(target)) !== target)
    throw new Error("Subagent baseline path is not canonical");
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.size > MAX_BASELINE_BYTES ||
      (info.mode & 0o077) !== 0
    )
      throw new Error("Subagent baseline is unsafe");
    const serialized = await handle.readFile("utf8");
    const after = await lstat(target);
    if (
      after.ino !== info.ino ||
      after.dev !== info.dev ||
      sha256(serialized) !== session.baselineSha256
    ) {
      throw new Error("Subagent baseline binding changed");
    }
    const parsed = JSON.parse(serialized) as Omit<
      SubagentWorktreeSnapshot,
      "files"
    > & { files: Array<SubagentWorktreeFile & { content?: string }> };
    const snapshot: SubagentWorktreeSnapshot = {
      ...parsed,
      files: parsed.files.map(({ content, ...file }) => ({
        ...file,
        ...(content !== undefined
          ? { buffer: Buffer.from(content, "base64") }
          : {}),
      })),
    };
    if (
      worktreeSnapshotHash(snapshot.files, snapshot.directories) !==
      session.sourceSnapshotSha256
    )
      throw new Error("Subagent baseline snapshot binding changed");
    return snapshot;
  } finally {
    await handle.close();
  }
}

export async function removeWorktreeBaseline(root: string): Promise<void> {
  await rm(`${root}.baseline.json`, { force: true });
}
