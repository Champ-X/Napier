import {
  mapToolReplayClass,
  type ToolReplayClassV1,
} from "@napier/contracts/tool-replay-class";
import type {
  ToolIdempotencyPolicyV2,
  ToolSideEffect,
} from "@napier/contracts/tool-protocol";

/** Tools with verified postcondition / reconciliation adapters (G04). */
const RECONCILIATION_ADAPTERS = new Set([
  "apply_patch",
  "workspace_file_apply",
]);

/**
 * Recovery eligibility class for a tool name + protocol fields.
 * Does not authorize replay by itself; automatic recovery still requires
 * settled evidence or a successful adapter check.
 */
export function resolveToolReplayClass(input: {
  toolName: string;
  sideEffect: ToolSideEffect;
  resultReplay: ToolIdempotencyPolicyV2["resultReplay"];
  hostSafeRerun?: boolean;
}): ToolReplayClassV1 {
  return mapToolReplayClass({
    sideEffect: input.sideEffect,
    resultReplay: input.resultReplay,
    hasReconciliationAdapter: RECONCILIATION_ADAPTERS.has(input.toolName),
    ...(input.hostSafeRerun !== undefined
      ? { hostSafeRerun: input.hostSafeRerun }
      : {}),
  }).class;
}

export function hasToolReconciliationAdapter(toolName: string): boolean {
  return RECONCILIATION_ADAPTERS.has(toolName);
}
