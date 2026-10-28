import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { RunEvent, RunRecord } from "@napier/contracts";
import { sha256 } from "./ed25519.js";
import { workspacePatchInvocations } from "./workspace-patch-invocation.js";
import { uncommittedPatchCandidates } from "./workspace-patch-uncommitted-evidence.js";
import { matchesWorkspacePatchPostcondition } from "./workspace-patch-reconciliation.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";
import { acquireWorkspacePathLocks } from "./workspace-write-lock.js";
/** Rechecks only the exact pending target; this observation grants no write permission. */
export async function inspectUncommittedWorkspacePatch(input: {
  workspaceRoot: string;
  dataRoot: string;
  run: RunRecord;
  events: RunEvent[];
  callId: string;
}) {
  if (
    input.run.status !== "interrupted" &&
    !(input.run.status === "failed" && input.run.outcome === "blocked_safety")
  )
    throw new Error("Pending patch requires a fenced original Run");
  const events = input.events.filter(
    (event) =>
      event.runId === input.run.id && event.threadId === input.run.threadId,
  );
  const proof = uncommittedPatchCandidates(events).find(
    (candidate) => candidate.callId === input.callId,
  );
  if (
    proof &&
    events.find((event) => event.seq === proof.terminalSeq)?.type !==
      `run.${input.run.status}`
  )
    throw new Error("Pending patch Run and terminal event disagree");
  if (!proof)
    throw new Error(
      "Pending patch has no proof that target commit was not entered",
    );
  const capsule = await workspacePatchInvocations(input.dataRoot).read(
    proof.invocation.capsuleSha256,
  );
  const root = await realpath(input.workspaceRoot);
  if (
    capsule.threadId !== input.run.threadId ||
    capsule.runId !== input.run.id ||
    capsule.callId !== input.callId ||
    capsule.toolDefinitionSha256 !== proof.invocation.toolDefinitionSha256 ||
    capsule.inputSha256 !== proof.invocation.inputSha256 ||
    capsule.workspaceRootSha256 !== sha256(root)
  )
    throw new Error("Pending patch private input binding changed");
  const relative = pendingPatchPath(capsule.args.path);
  const lock = await acquireWorkspacePathLocks(
    input.dataRoot,
    [path.join(root, relative)],
    "pending patch inspection",
  );
  try {
    const matches =
      capsule.args.operation === "create"
        ? await absentPatchTarget(root, relative)
        : await matchesWorkspacePatchPostcondition(
            root,
            relative,
            capsule.args.expectedSha256,
          );
    if (!matches)
      throw new Error(
        "Pending patch target precondition changed or is inaccessible",
      );
    return { proof, args: capsule.args, path: relative };
  } finally {
    await lock.release();
  }
}

function pendingPatchPath(value: string): string {
  const relative = path.normalize(value);
  if (
    path.isAbsolute(value) ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    relative === "." ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    relative.split(path.sep).some(isProtectedWorkspacePathSegment)
  )
    throw new Error("Pending patch path is outside its workspace scope");
  return relative;
}
export async function absentPatchTarget(
  root: string,
  relative: string,
): Promise<boolean> {
  let target = root;
  const segments = relative.split(path.sep);
  for (const [index, segment] of segments.entries()) {
    target = path.join(target, segment);
    const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!info) return true;
    if (
      info.isSymbolicLink() ||
      !info.isDirectory() ||
      index === segments.length - 1
    )
      return false;
  }
  return false;
}
