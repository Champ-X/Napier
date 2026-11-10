import type { ToolIdempotencyPolicyV2, ToolSideEffect } from "./tool-protocol.js";

/**
 * Recovery-facing replay class aligned with Pi Durable's safe/unsafe split,
 * without replacing ToolDefinitionV2 wire fields.
 *
 * `safe_rerun` is never inferred from sideEffect alone; a host must declare it.
 */
export type ToolReplayClassV1 =
  | "never"
  | "exact_result"
  | "reconcile"
  | "safe_rerun";

export type ToolReplayClassSourceV1 =
  | "idempotency_policy"
  | "reconciliation_adapter"
  | "host_declaration";

export interface ToolReplayClassReceiptV1 {
  kind: "napier.tool-replay-class";
  schemaVersion: 1;
  class: ToolReplayClassV1;
  source: ToolReplayClassSourceV1;
  resultReplay: ToolIdempotencyPolicyV2["resultReplay"];
  sideEffect: ToolSideEffect;
}

export interface MapToolReplayClassInput {
  sideEffect: ToolSideEffect;
  resultReplay: ToolIdempotencyPolicyV2["resultReplay"];
  /** True when a verified postcondition / reconciliation adapter owns this tool. */
  hasReconciliationAdapter?: boolean;
  /** Explicit host opt-in; never inferred from read-only naming. */
  hostSafeRerun?: boolean;
}

/** Pure mapping used by protocol validation and recovery projection. */
export function mapToolReplayClass(
  input: MapToolReplayClassInput,
): ToolReplayClassReceiptV1 {
  if (input.hostSafeRerun) {
    return receipt(input, "safe_rerun", "host_declaration");
  }
  if (input.hasReconciliationAdapter) {
    return receipt(input, "reconcile", "reconciliation_adapter");
  }
  if (
    input.sideEffect === "none" &&
    input.resultReplay === "exact_result_only"
  ) {
    return receipt(input, "exact_result", "idempotency_policy");
  }
  return receipt(input, "never", "idempotency_policy");
}

function receipt(
  input: MapToolReplayClassInput,
  replayClass: ToolReplayClassV1,
  source: ToolReplayClassSourceV1,
): ToolReplayClassReceiptV1 {
  return {
    kind: "napier.tool-replay-class",
    schemaVersion: 1,
    class: replayClass,
    source,
    resultReplay: input.resultReplay,
    sideEffect: input.sideEffect,
  };
}
