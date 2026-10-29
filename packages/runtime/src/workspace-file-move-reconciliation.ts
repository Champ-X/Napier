import path from "node:path";
import { realpath } from "node:fs/promises";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { RunEvent } from "@napier/contracts";
import { lockWorkspaceOperationChecks, recoveryInspectionReason, MAX_RECOVERY_OPERATIONS,
  type WorkspaceOperationRecoveryCheck } from "./workspace-operation-recovery-check.js";
import { matchesMoveState } from "./workspace-file-move-paths.js";
import { moveIntents, preparedMoveForBoundary, type MoveIntent, type MovePreparationReceipt } from "./workspace-file-move-preparation.js";
import { moveCommitState, moveReconciliationPayload, type MoveRecoveryEvidence } from "./workspace-file-move-evidence.js";
import type { PatchInterruptionReconciliation } from "./workspace-patch-interruption-reconciliation.js";
import type { AppendEventInput } from "./run-event-registry.js";

export async function interruptedWorkspaceMoveChecks(input: {
  workspaceRoot: string; dataRoot: string; events: RunEvent[]; boundaries: RunEvent[];
}) {
  if (!input.boundaries.length || input.boundaries.length > MAX_RECOVERY_OPERATIONS) throw new Error("move_inspection_scope_unsupported");
  const root = await realpath(input.workspaceRoot);
  return Promise.all(input.boundaries.map(async (boundary) => {
    const prepared = preparedMoveForBoundary(input.events, boundary);
    if (!prepared) throw new Error("move_preparation_missing_or_invalid");
    const intent = await boundIntent(input.dataRoot, prepared);
    if (!writerExited(intent.writerPid)) throw new Error("move_writer_still_available");
    const commit = moveCommitState(input.events, prepared);
    if (commit === "invalid") throw new Error("move_commit_gate_invalid");
    const state = commit === "entered" ? "after" : "before";
    return { check: moveCheck(root, intent, state), input: {
      threadId: prepared.threadId, runId: prepared.runId,
      type: commit === "entered" ? "workspace.file.move.reconciled" : "workspace.file.move.not_committed",
      category: "tool" as const, visibility: "debug" as const,
      payload: moveReconciliationPayload(prepared, commit === "entered"),
    } satisfies AppendEventInput };
  }));
}

export async function reconcileInterruptedWorkspaceMove(input: {
  workspaceRoot: string; dataRoot: string; events: RunEvent[]; boundaries: RunEvent[];
}): Promise<PatchInterruptionReconciliation> {
  try {
    const values = await interruptedWorkspaceMoveChecks(input);
    const lease = await lockWorkspaceOperationChecks(input.dataRoot, values.map((value) => value.check), "move recovery");
    return { inputs: values.map((value) => value.input), release: () => lease.release() };
  } catch (error) {
    return { inputs: [], release: async () => undefined, reason: recoveryInspectionReason(error, "move", "move recovery") };
  }
}

export async function settledWorkspaceMoveChecks(workspaceRoot: string, dataRoot: string,
  evidence: MoveRecoveryEvidence[]): Promise<WorkspaceOperationRecoveryCheck[]> {
  if (evidence.length > MAX_RECOVERY_OPERATIONS || evidence.some((value) => value.status !== "completed"))
    throw new Error("move_inspection_scope_unsupported");
  const root = await realpath(workspaceRoot);
  return Promise.all(evidence.map(async (value) => moveCheck(root, await boundIntent(dataRoot, value.prepared), "after")));
}

export async function reconcileSettledWorkspaceMoves(workspaceRoot: string, dataRoot: string,
  evidence: MoveRecoveryEvidence[]): Promise<void> {
  if (!evidence.length) return;
  const checks = await settledWorkspaceMoveChecks(workspaceRoot, dataRoot, evidence);
  const lease = await lockWorkspaceOperationChecks(dataRoot, checks, "move continuation check");
  await lease.release();
}

function moveCheck(root: string, intent: MoveIntent, state: "before" | "after"): WorkspaceOperationRecoveryCheck {
  return { paths: [intent.sourcePath, intent.destinationPath].map((value) => path.join(root, value)),
    filePath: path.join(root, state === "after" ? intent.destinationPath : intent.sourcePath),
    maxBytes: intent.file.bytes, mismatchReason: "move_postcondition_or_identity_changed",
    inspect: () => matchesMoveState(root, intent, state) };
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
