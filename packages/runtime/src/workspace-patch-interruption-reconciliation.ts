import {
  patchCommitWasNotEntered,
  patchNotCommittedPayload,
} from "./workspace-patch-not-committed.js";
import { realpath } from "node:fs/promises";
import path from "node:path";
import type { RunEvent } from "@napier/contracts";
import { sha256 } from "./ed25519.js";
import {
  preparedPatchForBoundary,
  workspacePatchIntents,
} from "./workspace-patch-preparation.js";
import { WorkspacePatchRecoveryCapsules } from "./workspace-patch-recovery-capsule.js";
import { matchesWorkspacePatchPostcondition } from "./workspace-patch-reconciliation.js";
import { patchReconciliationPayload } from "./workspace-patch-reconciled-evidence.js";
import { lockWorkspaceOperationChecks, recoveryInspectionReason,
  type WorkspaceOperationRecoveryCheck } from "./workspace-operation-recovery-check.js";
import type { AppendEventInput } from "./run-event-registry.js";

export interface PatchInterruptionReconciliation {
  inputs: AppendEventInput[];
  reason?: string;
  release(): Promise<void>;
}

/** Private bindings are loaded first; the caller acquires the union of all
 * patch/move paths before any postcondition is accepted. */
export async function interruptedWorkspacePatchChecks(input: {
  workspaceRoot: string; dataRoot: string; events: RunEvent[]; boundaries: RunEvent[];
}) {
  if (!input.boundaries.length || input.boundaries.length > 128)
    throw new Error("patch_inspection_limit");
  const root = await realpath(input.workspaceRoot);
  const prepared = input.boundaries.map((boundary) => {
    const value = preparedPatchForBoundary(input.events, boundary);
    if (!value) throw new Error("patch_preparation_missing_or_invalid");
    return value;
  });
  const values = await Promise.all(
    prepared.map(async (event) => {
      const receipt = event.payload;
      const [intent, binding] = await Promise.all([
        workspacePatchIntents(input.dataRoot).read(receipt.capsuleSha256),
        new WorkspacePatchRecoveryCapsules(input.dataRoot).read(
          receipt.recoveryCapsuleSha256,
        ),
      ]).catch(() => {
        throw new Error("patch_private_evidence_missing_or_invalid");
      });
      if (
        intent.runId !== event.runId ||
        intent.threadId !== event.threadId ||
        intent.callId !== receipt.callId ||
        intent.inputSha256 !== receipt.inputSha256 ||
        intent.recoveryCapsuleSha256 !== receipt.recoveryCapsuleSha256 ||
        binding.workspaceRootSha256 !== sha256(root) ||
        binding.callId !== receipt.callId ||
        binding.inputSha256 !== receipt.inputSha256 ||
        binding.pathSha256 !== receipt.pathSha256 ||
        binding.beforeSha256 !== receipt.beforeSha256 ||
        binding.afterSha256 !== receipt.afterSha256
      )
        throw new Error("patch_preparation_binding_changed");
      if (!writerExited(intent.writerPid))
        throw new Error("patch_writer_still_available");
      return { event, intent, binding };
    }),
  );
  if (new Set(values.map((v) => v.binding.pathSha256)).size !== values.length)
    throw new Error("patch_unsettled_path_conflict");
  return values.map(({ event, intent, binding }) => {
    const notCommitted = patchCommitWasNotEntered(input.events, event);
    const target = path.join(root, binding.path);
    const check: WorkspaceOperationRecoveryCheck = { paths: [target], maxBytes: 256 * 1024,
      ...(notCommitted ? {} : { filePath: target }),
      mismatchReason: "patch_postcondition_or_file_identity_changed",
      inspect: async () => notCommitted || matchesWorkspacePatchPostcondition(root, binding.path, binding.afterSha256, intent) };
    return { check, input: { threadId: event.threadId, runId: event.runId,
      type: notCommitted ? "workspace.patch.not_committed" : "workspace.patch.reconciled",
      category: "tool" as const, visibility: "debug" as const,
      payload: notCommitted ? patchNotCommittedPayload(event) : patchReconciliationPayload(event) } satisfies AppendEventInput };
  });
}

/** Keep the whole successful path set locked until the atomic authority fence. */
export async function reconcileInterruptedWorkspacePatches(input: {
  workspaceRoot: string; dataRoot: string; events: RunEvent[]; boundaries: RunEvent[];
}): Promise<PatchInterruptionReconciliation> {
  try {
    const values = await interruptedWorkspacePatchChecks(input);
    const lease = await lockWorkspaceOperationChecks(input.dataRoot, values.map((value) => value.check), "patch recovery");
    return { inputs: values.map((value) => value.input), release: () => lease.release() };
  } catch (error) {
    return { inputs: [], release: async () => undefined, reason: recoveryInspectionReason(error, "patch", "patch recovery") };
  }
}

function writerExited(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
  }
}
