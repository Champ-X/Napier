import type { RunEvent, RunLimits } from "@napier/contracts";

import {
  DEFAULT_RUN_CONVERGENCE_POLICY,
  evaluateRunConvergence,
  hasRunNoProgressPressure,
  type RunAcquisitionPhase,
  type RunConvergencePolicy,
  type RunConvergenceSnapshot,
} from "./run-convergence-policy.js";
import { projectValidatedRunProgressLedger } from "./run-progress-payload-codec.js";
import type {
  RunDirectiveDecision,
  RunDirectiveState,
} from "./run-progress-directive-types.js";

export type {
  RunConvergenceDirectiveState,
  RunDirectiveDecision,
  RunDirectiveState,
  RunNoProgressDirectiveState,
} from "./run-progress-directive-types.js";

/**
 * Recovery has one authoritative reducer: strict decoding, lineage validation
 * and state materialization all happen in the validated ledger projection.
 */
export function projectRunDirectiveState(
  events: readonly RunEvent[],
  runId: string,
  policy: Readonly<RunConvergencePolicy> = DEFAULT_RUN_CONVERGENCE_POLICY,
): RunDirectiveState {
  return projectValidatedRunProgressLedger(events, runId, policy)
    .directiveState;
}

export function nextRunDirectiveDecision(input: {
  state: RunDirectiveState;
  vector: RunConvergenceSnapshot;
  acquisitionPhase: RunAcquisitionPhase;
  limits: RunLimits;
  policy: Readonly<RunConvergencePolicy>;
}): RunDirectiveDecision | undefined {
  const { state, vector } = input;
  if (state.controlEpochVectorSha256 === vector.contentSha256) return undefined;
  const noProgress = nextActiveNoProgressDecision(state, vector);
  if (noProgress.stop) return noProgress.decision;
  const convergence = nextConvergenceDecision(input);
  if (convergence.stop) return convergence.decision;
  if (
    state.noProgress.phase === "idle" &&
    hasRunNoProgressPressure(vector, input.acquisitionPhase, input.policy)
  ) {
    return { kind: "no_progress_request", vector };
  }
  return undefined;
}

interface DirectiveEvaluation {
  stop: boolean;
  decision?: RunDirectiveDecision;
}

function nextActiveNoProgressDecision(
  state: RunDirectiveState,
  vector: RunConvergenceSnapshot,
): DirectiveEvaluation {
  const noProgress = state.noProgress;
  if (
    noProgress.phase === "requested" &&
    vector.turnIndex > noProgress.turnIndex
  ) {
    if (vector.progressed) {
      return {
        stop: true,
        decision: { kind: "no_progress_resolve", vector },
      };
    }
    if (!noProgress.delivered) return { stop: true };
    if (
      vector.unclassifiedActivityCountSinceProgress >
      noProgress.unclassifiedActivityBaseline
    ) {
      return {
        stop: true,
        decision: { kind: "no_progress_observability_degraded", vector },
      };
    }
    if (
      vector.failureDomainCountSinceProgress > noProgress.failureDomainBaseline
    ) {
      return {
        stop: true,
        decision: { kind: "no_progress_repair", vector },
      };
    }
    return { stop: true, decision: { kind: "no_progress_halt", vector } };
  }
  if (
    noProgress.phase === "repair" &&
    vector.turnIndex > noProgress.repairTurn
  ) {
    if (vector.progressed) {
      return {
        stop: true,
        decision: { kind: "no_progress_resolve", vector },
      };
    }
    if (
      vector.unclassifiedActivityCountSinceProgress >
      noProgress.unclassifiedActivityBaseline
    ) {
      return {
        stop: true,
        decision: { kind: "no_progress_observability_degraded", vector },
      };
    }
    return { stop: true, decision: { kind: "no_progress_halt", vector } };
  }
  if (noProgress.phase === "observability_degraded") {
    if (vector.progressed) {
      return {
        stop: true,
        decision: { kind: "no_progress_resolve", vector },
      };
    }
    if (vector.turnIndex >= noProgress.leaseThroughTurn) {
      return { stop: true, decision: { kind: "no_progress_halt", vector } };
    }
  }
  return { stop: false };
}

function nextConvergenceDecision(input: {
  state: RunDirectiveState;
  vector: RunConvergenceSnapshot;
  acquisitionPhase: RunAcquisitionPhase;
  limits: RunLimits;
  policy: Readonly<RunConvergencePolicy>;
}): DirectiveEvaluation {
  const { convergence } = input.state;
  const { vector } = input;
  if (
    convergence.phase !== "open" &&
    (vector.productProgressed || vector.acceptanceProgressed)
  ) {
    return {
      stop: true,
      decision: {
        kind: "convergence_reopen",
        reason: "product_progress",
        vector,
      },
    };
  }
  if (
    convergence.phase === "requested" &&
    vector.turnIndex > convergence.turnIndex &&
    convergence.delivered
  ) {
    return {
      stop: true,
      decision: { kind: "convergence_activate", vector },
    };
  }
  if (convergence.phase === "open") {
    const reason = evaluateRunConvergence(
      vector,
      input.acquisitionPhase,
      input.limits,
      input.policy,
    );
    if (reason) {
      return {
        stop: true,
        decision: { kind: "convergence_request", reason, vector },
      };
    }
  }
  if (
    convergence.phase === "requested" &&
    vector.turnIndex <= convergence.turnIndex
  ) {
    return { stop: true };
  }
  return { stop: false };
}
