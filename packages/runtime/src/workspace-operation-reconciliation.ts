import type { RunEvent } from "@napier/contracts";
import { field } from "./workspace-file-move-preparation.js";
import { preparedPatchForBoundary, workspacePatchIntents } from "./workspace-patch-preparation.js";
import { interruptedWorkspaceMoveChecks, settledWorkspaceMoveChecks } from "./workspace-file-move-reconciliation.js";
import { interruptedWorkspacePatchChecks } from "./workspace-patch-interruption-reconciliation.js";
import { settledWorkspacePatchChecks } from "./workspace-patch-reconciliation.js";
import { moveRecoveryEvidence } from "./workspace-file-move-evidence.js";
import { loadSettledPatchRecoveryEvidence } from "./workspace-patch-result-recovery.js";
import { independentRecoveryBoundaryScope, operationReconciliationReason } from "./workspace-operation-recovery-scope.js";
import { inspectWorkspaceOperationChecks, lockWorkspaceOperationChecks, MAX_RECOVERY_OPERATIONS, recoveryInspectionReason } from "./workspace-operation-recovery-check.js";

/** Only built-in adapters; all participants share one lease and one decision. */
export async function reconcileInterruptedWorkspaceOperations(input: {
  workspaceRoot: string; dataRoot: string; events: RunEvent[]; boundaries: RunEvent[];
}) {
  const terminalReason = operationReconciliationReason(input.boundaries);
  const prefix = input.boundaries.every((event) => field(event, "route") === "apply_patch") ? "patch"
    : input.boundaries.every((event) => field(event, "route") === "workspace_file_apply") ? "move" : "operation";
  const label = `${prefix} recovery`;
  try {
    if (!independentRecoveryBoundaryScope(input.events, input.boundaries)) throw new Error(`${prefix}_reconciliation_scope_unsupported`);
    const moves = input.boundaries.filter((event) => field(event, "route") === "workspace_file_apply");
    const patches = input.boundaries.filter((event) => field(event, "route") === "apply_patch");
    const values = [
      ...(moves.length ? await interruptedWorkspaceMoveChecks({ ...input, boundaries: moves }) : []),
      ...(patches.length ? await interruptedWorkspacePatchChecks({ ...input, boundaries: patches }) : []),
    ];
    const settled = await settledOperationChecks(input.workspaceRoot, input.dataRoot, input.events);
    if (values.length + settled.patches.length + settled.moves.length > MAX_RECOVERY_OPERATIONS)
      throw new Error("operation_inspection_limit");
    const covered = new Set([...input.boundaries.map((event) => field(event, "parentCallId")),
      ...settled.patches.map((value) => value.callId), ...settled.moves.map((value) => value.callId)]);
    if (input.events.some((event) => event.type === "tool.started" &&
      ["workspace_file_apply", "apply_patch"].includes(String(field(event, "toolName"))) && !covered.has(field(event, "callId"))))
      throw new Error("operation_recovery_participant_missing");
    const checks = [...settled.checks];
    for (const value of values) {
      const prior = checks.findIndex((check) => check.paths.length === 1 && value.check.paths.length === 1 && check.paths[0] === value.check.paths[0]);
      if (prior < 0 || moves.length || settled.moves.length) { checks.push(value.check); continue; }
      // Preserve the existing proved patch-only version chain. An interrupted
      // last replace can supersede the earlier settled postcondition; a proven
      // uncommitted replace leaves that earlier postcondition in force.
      const boundary = patches.find((event) => field(event, "operationId") === value.input.payload["operationId"]);
      const prepared = boundary && preparedPatchForBoundary(input.events, boundary);
      const previous = prepared && settled.patches.filter((patch) => patch.pathSha256 === prepared.payload.pathSha256)
        .sort((left, right) => right.completedSeq - left.completedSeq)[0];
      if (!previous || !prepared || previous.afterSha256 !== prepared.payload.beforeSha256 || previous.completedSeq >= prepared.seq)
        throw new Error("patch_version_chain_changed");
      if (value.input.type !== "workspace.patch.not_committed") checks[prior] = value.check;
    }
    const lease = await lockWorkspaceOperationChecks(input.dataRoot, checks, label);
    return { inputs: values.map((value) => value.input), terminalReason, release: () => lease.release() };
  } catch (error) {
    return { inputs: [], reason: recoveryInspectionReason(error, prefix, label), terminalReason, release: async () => undefined };
  }
}

/** The caller retains this lease through read-only continuation, so a later
 * cooperative write cannot invalidate an earlier participant between checks. */
export async function reconcileSettledWorkspaceOperations(workspaceRoot: string, dataRoot: string, events: RunEvent[]) {
  const values = await settledOperationChecks(workspaceRoot, dataRoot, events);
  const lease = await lockWorkspaceOperationChecks(dataRoot, values.checks, "operation continuation check").catch((error: unknown) => {
    if (error instanceof Error && error.message === "move_postcondition_or_identity_changed")
      throw new Error("Move recovery postcondition or file identity changed", { cause: error });
    if (error instanceof Error && error.message === "patch_postcondition_or_file_identity_changed")
      throw new Error("Patch recovery postcondition changed", { cause: error });
    throw error;
  });
  return { patches: values.patches, moves: values.moves, retainedResults: values.retainedResults, release: () => lease.release(),
    recheck: async () => {
      // Reload private evidence too: retaining a path lease does not make a
      // capsule immutable against noncooperative external modification.
      const current = await settledOperationChecks(workspaceRoot, dataRoot, events);
      await inspectWorkspaceOperationChecks(current.checks);
    } };
}

async function settledOperationChecks(workspaceRoot: string, dataRoot: string, events: RunEvent[]) {
  const { patches, retainedResults } = await loadSettledPatchRecoveryEvidence(dataRoot, events);
  const moves = moveRecoveryEvidence(events).filter((value) => value.status === "completed");
  if (patches.length + moves.length > MAX_RECOVERY_OPERATIONS) throw new Error("operation_inspection_limit");
  const preparedHistory = events.some((event) => ["workspace.patch.prepared", "workspace.file.move.prepared"].includes(event.type));
  const boundPatches = await Promise.all(patches.map(async (patch) => {
    const preparations = events.filter((event) => event.type === "workspace.patch.prepared" && field(event, "callId") === patch.callId);
    const boundary = events.find((event) => field(event, "operationId") === patch.operationId && field(event, "executionEffectBoundary") === true);
    const prepared = boundary && preparedPatchForBoundary(events, boundary);
    if ((preparations.length || moves.length || preparedHistory) && (!prepared || prepared.threadId !== boundary?.threadId ||
      prepared.payload.recoveryCapsuleSha256 !== patch.capsuleSha256 || prepared.payload.inputSha256 !== patch.inputSha256 ||
      prepared.payload.pathSha256 !== patch.pathSha256 || prepared.payload.beforeSha256 !== patch.beforeSha256 ||
      prepared.payload.afterSha256 !== patch.afterSha256))
      throw new Error("patch_preparation_missing_or_invalid");
    if (prepared) {
      const intent = await workspacePatchIntents(dataRoot).read(prepared.payload.capsuleSha256);
      if (intent.threadId !== prepared.threadId || intent.runId !== prepared.runId)
        throw new Error("patch_preparation_binding_changed");
    }
    return prepared ? { ...patch, preparedCapsuleSha256: prepared.payload.capsuleSha256 } : patch;
  }));
  return { patches, moves, retainedResults, checks: [
    ...await settledWorkspacePatchChecks(workspaceRoot, dataRoot, boundPatches),
    ...await settledWorkspaceMoveChecks(workspaceRoot, dataRoot, moves),
  ] };
}
