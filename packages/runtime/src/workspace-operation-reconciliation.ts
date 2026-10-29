import type { RunEvent } from "@napier/contracts";
import { field } from "./workspace-file-move-preparation.js";
import { reconcileInterruptedWorkspaceMove } from "./workspace-file-move-reconciliation.js";
import { reconcileInterruptedWorkspacePatches } from "./workspace-patch-interruption-reconciliation.js";

/** Only built-in adapters; a progress label never confers recovery authority. */
export async function reconcileInterruptedWorkspaceOperations(input: {
  workspaceRoot: string; dataRoot: string; events: RunEvent[]; boundaries: RunEvent[];
}) {
  if (input.boundaries.length && input.boundaries.every((event) => field(event, "route") === "apply_patch"))
    return { ...await reconcileInterruptedWorkspacePatches(input), terminalReason: "patch_postcondition_reconciled" as const };
  if (input.boundaries.length === 1 && field(input.boundaries[0], "route") === "workspace_file_apply")
    return { ...await reconcileInterruptedWorkspaceMove(input), terminalReason: "operation_postcondition_reconciled" as const };
  return { inputs: [], reason: "operation_reconciliation_scope_unsupported", terminalReason: "operation_postcondition_reconciled" as const,
    release: async () => undefined };
}
