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
import {
  acquireWorkspacePathLocks,
  type WorkspacePathLockLease,
} from "./workspace-write-lock.js";
import type { AppendEventInput } from "./run-event-registry.js";

export interface PatchInterruptionReconciliation {
  inputs: AppendEventInput[];
  reason?: string;
  release(): Promise<void>;
}

/** Keep every successful path locked until the atomic Run/authority fence commits. */
export async function reconcileInterruptedWorkspacePatches(input: {
  workspaceRoot: string;
  dataRoot: string;
  events: RunEvent[];
  boundaries: RunEvent[];
}): Promise<PatchInterruptionReconciliation> {
  const locks: WorkspacePathLockLease[] = [];
  const release = async () => {
    for (const lock of locks.splice(0)) await lock.release();
  };
  try {
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
    locks.push(
      await acquireWorkspacePathLocks(
        input.dataRoot,
        values.map((v) => path.join(root, v.binding.path)),
        "patch recovery",
      ).catch(() => {
        throw new Error("patch_target_busy_or_inaccessible");
      }),
    );
    for (const { intent, binding } of values) {
      if (
        !(await matchesWorkspacePatchPostcondition(
          root,
          binding.path,
          binding.afterSha256,
          intent,
        ))
      )
        throw new Error("patch_postcondition_or_file_identity_changed");
    }
    return {
      inputs: values.map(({ event }) => ({
        threadId: event.threadId,
        runId: event.runId,
        type: "workspace.patch.reconciled",
        category: "tool",
        visibility: "debug",
        payload: patchReconciliationPayload(event),
      })),
      release,
    };
  } catch (error) {
    await release();
    return {
      inputs: [],
      reason:
        error instanceof Error && /^patch_[a-z_]+$/u.test(error.message)
          ? error.message
          : "patch_environment_inaccessible",
      release,
    };
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
