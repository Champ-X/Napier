import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  subagentWorktreeModifiedLspFiles,
  type SubagentWorktreeChange,
} from "./subagent-worktree-diff.js";
import type { WorktreePreviewSource } from "./subagent-worktree-mutation-model.js";
import { SUBAGENT_WORKTREE_POLICY } from "./subagent-worktree-policy.js";
import { readDependencyHash } from "./subagent-worktree-read-set.js";
import { readWorktreeSnapshot } from "./subagent-worktree-snapshot.js";

const run = promisify(execFile);

// First preflight freezes the exact merge used by diagnostics and tests. Later
// preflights only validate it; they must never silently rebase after validation.
export async function prepareWorktreeMerge(
  source: WorktreePreviewSource,
  dataRoot: string,
  signal?: AbortSignal,
): Promise<void> {
  const writes = new Set(source.changes.map((change) => change.path));
  const current = await readWorktreeSnapshot(source.sourceRoot, {
    retainPaths: writes,
    ...(signal ? { signal } : {}),
    scopes: [
      ...source.readDependencies,
      ...[...writes].map((path) => ({ path, kind: "file" as const })),
    ],
  });
  for (const dependency of source.readDependencies) {
    if (readDependencyHash(current, dependency, writes) !== dependency.sha256) {
      throw new Error(
        `Subagent worktree read dependency changed: ${dependency.path} (${dependency.kind})`,
      );
    }
  }
  const byPath = new Map(current.files.map((file) => [file.path, file]));
  const merged: SubagentWorktreeChange[] = [];
  for (const change of source.changes) {
    signal?.throwIfAborted();
    const file = byPath.get(change.path);
    const currentHash = file?.fileSha256 ?? null;
    if (
      file &&
      change.beforeMode !== undefined &&
      file.mode !== change.beforeMode
    )
      conflict(change.path, "file mode changed");
    if (currentHash === change.beforeSha256) {
      merged.push(change);
      continue;
    }
    if (source.mergePrepared || change.operation !== "modify" || !file?.buffer)
      conflict(change.path, "workspace drift");
    const currentText = new TextDecoder("utf-8", { fatal: true }).decode(
      file.buffer,
    );
    const afterText = await mergeText(dataRoot, change, currentText, signal);
    if (sha256(afterText) === currentHash)
      conflict(change.path, "candidate is already present");
    merged.push({
      ...change,
      beforeSha256: currentHash,
      beforeText: currentText,
      afterText,
      afterSha256: sha256(afterText),
    });
  }
  if (source.mergePrepared) return;
  source.changes = merged;
  source.files = subagentWorktreeModifiedLspFiles(merged);
  source.sourcePreviewResultSha256 = sha256(
    canonicalJson({
      candidate: source.sourcePreviewResultSha256,
      merge: merged.map(
        ({ pathSha256, beforeSha256, afterSha256, beforeMode }) => ({
          pathSha256,
          beforeSha256,
          afterSha256,
          beforeMode,
        }),
      ),
      readDependencies: source.readDependencies,
    }),
  );
  source.mergePrepared = true;
}

async function mergeText(
  dataRoot: string,
  change: SubagentWorktreeChange,
  current: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = await mkdtemp(path.join(dataRoot, ".subagent-merge-"));
  try {
    const files = ["current", "base", "candidate"].map((name) =>
      path.join(root, name),
    );
    await Promise.all(
      [current, change.beforeText!, change.afterText!].map((text, index) =>
        writeFile(files[index]!, text, { mode: 0o600, flag: "wx" }),
      ),
    );
    let merged: string;
    try {
      const result = await run(
        "git",
        [
          "-c",
          "merge.conflictStyle=diff3",
          "merge-file",
          "--stdout",
          "--diff3",
          "--",
          ...files,
        ],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 10_000,
          maxBuffer: 4 * 1024 * 1024,
          ...(signal ? { signal } : {}),
        },
      );
      merged = result.stdout;
    } catch (error) {
      signal?.throwIfAborted();
      const code =
        error && typeof error === "object" && "code" in error
          ? error.code
          : undefined;
      conflict(
        change.path,
        code === "ENOENT"
          ? "Git merge-file is unavailable; resolve the overlap explicitly"
          : "overlapping edits",
      );
    }
    if (
      Buffer.byteLength(merged) > SUBAGENT_WORKTREE_POLICY.maxWriteFileBytes ||
      merged.includes("\0")
    )
      conflict(change.path, "merged content exceeds text policy");
    return merged;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function conflict(file: string, reason: string): never {
  throw new Error(
    `Subagent worktree merge conflicts with workspace drift: ${file} (${reason})`,
  );
}
