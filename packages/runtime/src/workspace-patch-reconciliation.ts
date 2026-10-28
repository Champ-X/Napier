import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import { workspacePatchIntents } from "./workspace-patch-preparation.js";
import { sha256 } from "./ed25519.js";
import type { SettledPatchRecoveryEvidence } from "./run-patch-recovery-evidence.js";
import { WorkspacePatchRecoveryCapsules } from "./workspace-patch-recovery-capsule.js";

/** Observes only known targets. Neither replay nor filesystem mutation occurs. */
export async function reconcileSettledWorkspacePatches(
  workspaceRoot: string,
  dataRoot: string,
  patches: SettledPatchRecoveryEvidence[],
): Promise<void> {
  if (!patches.length) return;
  if (patches.length > 128)
    throw new Error("Patch recovery inspection limit exceeded");
  const root = await realpath(workspaceRoot);
  const capsules = new WorkspacePatchRecoveryCapsules(dataRoot);
  const latest = new Map<
    string,
    {
      path: string;
      afterSha256: string;
      identity?: { dev: number; ino: number };
    }
  >();
  for (const patch of [...patches].sort(
    (a, b) => a.completedSeq - b.completedSeq,
  )) {
    const capsule = await capsules.read(patch.capsuleSha256).catch(() => {
      throw new Error("Patch recovery private evidence is missing or invalid");
    });
    if (
      capsule.callId !== patch.callId ||
      capsule.inputSha256 !== patch.inputSha256 ||
      capsule.workspaceRootSha256 !== sha256(root) ||
      capsule.pathSha256 !== patch.pathSha256 ||
      capsule.beforeSha256 !== patch.beforeSha256 ||
      capsule.afterSha256 !== patch.afterSha256
    ) {
      throw new Error("Patch recovery evidence binding changed");
    }
    const previous = latest.get(capsule.pathSha256);
    if (previous && previous.afterSha256 !== capsule.beforeSha256) {
      throw new Error("Patch recovery version chain changed");
    }
    const identity = patch.preparedCapsuleSha256
      ? await workspacePatchIntents(dataRoot)
          .read(patch.preparedCapsuleSha256)
          .catch(() => {
            throw new Error("Patch recovery intent is missing or invalid");
          })
      : undefined;
    if (
      identity &&
      (identity.callId !== patch.callId ||
        identity.inputSha256 !== patch.inputSha256 ||
        identity.recoveryCapsuleSha256 !== patch.capsuleSha256)
    )
      throw new Error("Patch recovery intent binding changed");
    latest.set(capsule.pathSha256, {
      ...capsule,
      ...(identity ? { identity } : {}),
    });
  }
  for (const target of latest.values()) {
    if (
      !(await matchesWorkspacePatchPostcondition(
        root,
        target.path,
        target.afterSha256,
        target.identity,
      ))
    ) {
      throw new Error(
        "Patch recovery postcondition changed or is inaccessible; inspect the current workspace before continuing",
      );
    }
  }
}

export async function matchesWorkspacePatchPostcondition(
  root: string,
  relative: string,
  expected: string,
  identity?: { dev: number; ino: number },
): Promise<boolean> {
  let handle;
  try {
    let target = root;
    // Reject aliases, symlink parents and leaves, including links staying in root.
    for (const segment of relative.split(path.sep)) {
      target = path.join(target, segment);
      if ((await lstat(target)).isSymbolicLink()) return false;
    }
    if ((await realpath(target)) !== target) return false;
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || before.size > 256 * 1024) return false;
    const buffer = Buffer.alloc(before.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const read = await handle.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead,
      );
      if (!read.bytesRead) break;
      bytesRead += read.bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(target);
    return (
      (!identity ||
        (before.dev === identity.dev && before.ino === identity.ino)) &&
      before.size === bytesRead &&
      after.size === before.size &&
      before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs &&
      current.ino === before.ino &&
      current.dev === before.dev &&
      (await realpath(target)) === target &&
      sha256(buffer.subarray(0, bytesRead)) === expected
    );
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}
