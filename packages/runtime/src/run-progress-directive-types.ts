import type { RunConvergenceSnapshot } from "./run-convergence-policy.js";

export type RunConvergenceDirectiveState =
  | { phase: "open" }
  | {
      phase: "requested";
      directiveId: string;
      turnIndex: number;
      delivered: boolean;
    }
  | {
      phase: "active";
      directiveId: string;
      requestedTurn: number;
      graceThroughTurn: number;
    };

interface NoProgressRequest {
  directiveId: string;
  turnIndex: number;
  failureDomainBaseline: number;
  unclassifiedActivityBaseline: number;
  rerouteContentSha256: string;
  delivered: boolean;
}

export type RunNoProgressDirectiveState =
  | { phase: "idle" }
  | ({ phase: "requested" } & NoProgressRequest)
  | ({ phase: "repair"; repairTurn: number } & NoProgressRequest)
  | ({
      phase: "observability_degraded";
      decisionId: string;
      leaseThroughTurn: number;
    } & NoProgressRequest)
  | ({ phase: "halted"; haltedTurn: number } & NoProgressRequest);

export interface RunDirectiveState {
  controlEpochId: string;
  /** Prevents a pre-epoch vector from issuing a post-epoch decision. */
  controlEpochVectorSha256?: string;
  convergence: RunConvergenceDirectiveState;
  noProgress: RunNoProgressDirectiveState;
  latestVector?: RunConvergenceSnapshot;
}

export type RunDirectiveDecision =
  | {
      kind: "convergence_request";
      reason: import("./run-convergence-policy.js").RunConvergenceReason;
      vector: RunConvergenceSnapshot;
    }
  | { kind: "convergence_activate"; vector: RunConvergenceSnapshot }
  | {
      kind: "convergence_reopen";
      reason: "product_progress";
      vector: RunConvergenceSnapshot;
    }
  | { kind: "no_progress_request"; vector: RunConvergenceSnapshot }
  | { kind: "no_progress_resolve"; vector: RunConvergenceSnapshot }
  | { kind: "no_progress_repair"; vector: RunConvergenceSnapshot }
  | {
      kind: "no_progress_observability_degraded";
      vector: RunConvergenceSnapshot;
    }
  | { kind: "no_progress_halt"; vector: RunConvergenceSnapshot };
