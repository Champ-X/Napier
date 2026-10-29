import path from "node:path";
import { realpath } from "node:fs/promises";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { RunEvent } from "@napier/contracts";
import { acquireWorkspacePathLocks } from "./workspace-write-lock.js";
import { matchesMoveState } from "./workspace-file-move-paths.js";
import { moveIntents, preparedMoveForBoundary, type MoveIntent, type MovePreparationReceipt } from "./workspace-file-move-preparation.js";
import { moveCommitState, moveReconciliationPayload, type MoveRecoveryEvidence } from "./workspace-file-move-evidence.js";
import type { PatchInterruptionReconciliation } from "./workspace-patch-interruption-reconciliation.js";

export async function reconcileInterruptedWorkspaceMove(input: {
  workspaceRoot: string; dataRoot: string; events: RunEvent[]; boundaries: RunEvent[];
}): Promise<PatchInterruptionReconciliation> {
  let lease: Awaited<ReturnType<typeof acquireWorkspacePathLocks>> | undefined;
  const release = async () => { const current = lease; lease = undefined; await current?.release(); };
  try {
    if (input.boundaries.length !== 1) throw new Error("move_inspection_scope_unsupported");
    const prepared = preparedMoveForBoundary(input.events, input.boundaries[0]!);
    if (!prepared) throw new Error("move_preparation_missing_or_invalid");
    const intent = await boundIntent(input.dataRoot, prepared);
    if (!writerExited(intent.writerPid)) throw new Error("move_writer_still_available");
    const commit = moveCommitState(input.events, prepared);
    if (commit === "invalid") throw new Error("move_commit_gate_invalid");
    const root = await realpath(input.workspaceRoot);
    lease = await acquireWorkspacePathLocks(input.dataRoot,
      [intent.sourcePath, intent.destinationPath].map((p) => path.join(root, p)), "move recovery")
      .catch((error: unknown) => { throw new Error(error instanceof Error && error.message === "move recovery target is already being edited"
        ? "move_target_busy" : "move_target_inaccessible"); });
    if (!(await matchesMoveState(root, intent, commit === "entered" ? "after" : "before")))
      throw new Error("move_postcondition_or_identity_changed");
    return { inputs: [{ threadId: prepared.threadId, runId: prepared.runId,
      type: commit === "entered" ? "workspace.file.move.reconciled" : "workspace.file.move.not_committed",
      category: "tool", visibility: "debug", payload: moveReconciliationPayload(prepared, commit === "entered") }], release };
  } catch (error) {
    await release();
    return { inputs: [], release, reason: error instanceof Error && /^move_[a-z_]+$/u.test(error.message)
      ? error.message : "move_environment_inaccessible" };
  }
}

export async function reconcileSettledWorkspaceMoves(workspaceRoot: string, dataRoot: string,
  evidence: MoveRecoveryEvidence[]): Promise<void> {
  if (!evidence.length) return;
  if (evidence.length !== 1 || evidence[0]!.status !== "completed") throw new Error("move_inspection_scope_unsupported");
  const intent = await boundIntent(dataRoot, evidence[0]!.prepared);
  const root = await realpath(workspaceRoot);
  const lease = await acquireWorkspacePathLocks(dataRoot,
    [intent.sourcePath, intent.destinationPath].map((p) => path.join(root, p)), "move continuation check");
  try {
    if (!(await matchesMoveState(root, intent, "after"))) throw new Error("Move recovery postcondition or file identity changed");
  } finally { await lease.release(); }
}

async function boundIntent(dataRoot: string, prepared: RunEvent & { payload: MovePreparationReceipt }): Promise<MoveIntent> {
  const value = await moveIntents(dataRoot).read(prepared.payload.capsuleSha256).catch(() => { throw new Error("move_private_evidence_missing_or_invalid"); });
  const receipt = prepared.payload;
  if (value.threadId !== prepared.threadId || value.runId !== prepared.runId || value.callId !== receipt.callId ||
      value.operationId !== receipt.operationId || value.inputSha256 !== receipt.inputSha256 || value.planSha256 !== receipt.planSha256 ||
      sha256(value.sourcePath) !== receipt.sourcePathSha256 || sha256(value.destinationPath) !== receipt.destinationPathSha256 ||
      value.file.sha256 !== receipt.fileSha256 || value.contentSha256 !== receipt.capsuleSha256 ||
      canonicalJson(value.sourcePath) === canonicalJson(value.destinationPath)) throw new Error("move_preparation_binding_changed");
  return value;
}
function writerExited(pid: number): boolean {
  try { process.kill(pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}
