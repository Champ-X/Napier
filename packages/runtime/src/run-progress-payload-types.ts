import type { JsonObject } from "@napier/contracts";

import type { RunConvergenceSnapshot } from "./run-convergence-policy.js";
import type { RunDirectiveState } from "./run-progress-directive-types.js";

export type RunProgressPayloadValidationCode =
  | "event_order"
  | "event_schema"
  | "payload_shape"
  | "payload_schema"
  | "content_hash"
  | "projection_id"
  | "turn_binding"
  | "vector_chain"
  | "vector_monotonicity"
  | "policy_binding"
  | "vector_binding"
  | "control_epoch_lineage"
  | "directive_lineage"
  | "decision_identity";

export class RunProgressPayloadValidationError extends Error {
  override readonly name = "RunProgressPayloadValidationError";

  constructor(
    readonly code: RunProgressPayloadValidationCode,
    message: string,
    readonly eventSeq?: number,
  ) {
    super(
      eventSeq === undefined ? message : `${message} (event seq ${eventSeq})`,
    );
  }
}

export interface ValidatedRunProgressVector extends RunConvergenceSnapshot {
  sourceSchemaVersion: 1 | 2;
  /** Legacy vectors are hydration baselines, never inputs to current policy. */
  decisionEligible: boolean;
  eventSeq: number;
  turnCompletedSeq: number;
  projectionId?: string;
  predecessorContentSha256: string;
  rawPayload: Readonly<JsonObject>;
}

export type ValidatedRunProgressDecisionKind =
  | "legacy_action_first"
  | "no_progress_request"
  | "no_progress_resolve"
  | "no_progress_repair"
  | "no_progress_observability_degraded"
  | "no_progress_halt"
  | "convergence_request"
  | "convergence_activate"
  | "convergence_reopen";

export interface ValidatedRunProgressDecision {
  sourceGeneration: "legacy_v1" | "current_v1";
  kind: ValidatedRunProgressDecisionKind;
  eventSeq: number;
  decisionId: string;
  progressVectorSha256: string;
  parentControlEpochId?: string;
  contentSha256: string;
  rawPayload: Readonly<JsonObject>;
}

export interface ValidatedRunProgressLedger {
  vectors: readonly ValidatedRunProgressVector[];
  decisions: readonly ValidatedRunProgressDecision[];
  controlEpochId: string;
  directiveState: RunDirectiveState;
}

export type CodecConvergenceState =
  | { phase: "open" }
  | {
      phase: "requested" | "active";
      id: string;
      delivered: boolean;
      requestedTurn: number;
      instructionSha256: string;
      graceThroughTurn?: number;
    };

export type CodecNoProgressState =
  | { phase: "idle" }
  | {
      phase: "requested" | "repair" | "observability_degraded" | "halted";
      id: string;
      contentSha256: string;
      delivered: boolean;
      requestedTurn: number;
      failureDomainBaseline: number;
      unclassifiedActivityBaseline: number;
      instructionSha256: string;
      phaseTurn: number;
      leaseThroughTurn?: number;
      decisionId?: string;
    };
