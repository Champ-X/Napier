import type { JsonObject, RunEvent } from "@napier/contracts";

import type { RunConvergencePolicy } from "./run-convergence-policy.js";
import type { RunDirectiveState } from "./run-progress-directive-types.js";
import {
  fail,
  validateDirectiveDelivery,
} from "./run-progress-payload-primitives.js";
import type {
  CodecConvergenceState,
  CodecNoProgressState,
  ValidatedRunProgressDecision,
  ValidatedRunProgressDecisionKind,
  ValidatedRunProgressVector,
} from "./run-progress-payload-types.js";

export interface MutableRunProgressDirectiveProjection {
  policy: Readonly<RunConvergencePolicy>;
  convergence: CodecConvergenceState;
  noProgress: CodecNoProgressState;
}

export function applyValidatedDirectiveDelivery(
  state: MutableRunProgressDirectiveProjection,
  event: RunEvent,
): void {
  const delivery = validateDirectiveDelivery(event);
  let matched = false;
  const convergence = state.convergence;
  if (convergence.phase !== "open" && convergence.id === delivery.id) {
    if (convergence.delivered) {
      fail(
        "directive_lineage",
        "Run progress convergence directive was delivered twice",
        event.seq,
      );
    }
    if (
      delivery.kind !== "convergence" ||
      delivery.textSha256 !== convergence.instructionSha256
    ) {
      fail(
        "directive_lineage",
        "Run progress convergence delivery does not match its request",
        event.seq,
      );
    }
    state.convergence = { ...convergence, delivered: true };
    matched = true;
  }
  const noProgress = state.noProgress;
  if (noProgress.phase !== "idle" && noProgress.id === delivery.id) {
    if (noProgress.delivered) {
      fail(
        "directive_lineage",
        "Run no-progress directive was delivered twice",
        event.seq,
      );
    }
    if (
      delivery.kind !== "no_progress" ||
      delivery.textSha256 !== noProgress.instructionSha256
    ) {
      fail(
        "directive_lineage",
        "Run no-progress delivery does not match its request",
        event.seq,
      );
    }
    state.noProgress = { ...noProgress, delivered: true };
    matched = true;
  }
  if (!matched) {
    fail(
      "directive_lineage",
      "Run progress directive delivery has no pending parent",
      event.seq,
    );
  }
}

export function applyValidatedCurrentDecision(
  state: MutableRunProgressDirectiveProjection,
  kind: Exclude<ValidatedRunProgressDecisionKind, "legacy_action_first">,
  decoded: ValidatedRunProgressDecision,
  value: JsonObject,
  vector: ValidatedRunProgressVector,
  eventSeq: number,
): void {
  if (kind === "convergence_request") {
    return applyConvergenceRequest(state, decoded, value, vector, eventSeq);
  }
  if (kind === "convergence_activate") {
    return applyConvergenceActivation(state, decoded, value, vector, eventSeq);
  }
  if (kind === "convergence_reopen") {
    return applyConvergenceReopen(state, value, eventSeq);
  }
  if (kind === "no_progress_request") {
    return applyNoProgressRequest(state, decoded, value, vector, eventSeq);
  }
  applyNoProgressOutcome(state, kind, decoded, value, vector, eventSeq);
}

function applyConvergenceRequest(
  state: MutableRunProgressDirectiveProjection,
  decoded: ValidatedRunProgressDecision,
  value: JsonObject,
  vector: ValidatedRunProgressVector,
  eventSeq: number,
): void {
  if (state.convergence.phase !== "open") {
    fail(
      "directive_lineage",
      "Convergence request does not start from open state",
      eventSeq,
    );
  }
  state.convergence = {
    phase: "requested",
    id: decoded.decisionId,
    delivered: false,
    requestedTurn: vector.turnIndex,
    instructionSha256: String(value["instructionSha256"]),
  };
}

function applyConvergenceActivation(
  state: MutableRunProgressDirectiveProjection,
  decoded: ValidatedRunProgressDecision,
  value: JsonObject,
  vector: ValidatedRunProgressVector,
  eventSeq: number,
): void {
  const convergence = state.convergence;
  if (
    convergence.phase !== "requested" ||
    !convergence.delivered ||
    vector.turnIndex <= convergence.requestedTurn ||
    value["parentDirectiveId"] !== convergence.id
  ) {
    fail(
      "directive_lineage",
      "Convergence activation has no delivered request parent",
      eventSeq,
    );
  }
  state.convergence = {
    phase: "active",
    id: decoded.decisionId,
    delivered: true,
    requestedTurn: convergence.requestedTurn,
    instructionSha256: convergence.instructionSha256,
    graceThroughTurn: Number(value["graceThroughTurn"]),
  };
}

function applyConvergenceReopen(
  state: MutableRunProgressDirectiveProjection,
  value: JsonObject,
  eventSeq: number,
): void {
  if (
    state.convergence.phase === "open" ||
    value["parentDirectiveId"] !== state.convergence.id
  ) {
    fail(
      "directive_lineage",
      "Convergence reopen has a stale parent",
      eventSeq,
    );
  }
  state.convergence = { phase: "open" };
}

function applyNoProgressRequest(
  state: MutableRunProgressDirectiveProjection,
  decoded: ValidatedRunProgressDecision,
  value: JsonObject,
  vector: ValidatedRunProgressVector,
  eventSeq: number,
): void {
  if (
    state.noProgress.phase !== "idle" ||
    value["directiveId"] !== decoded.decisionId
  ) {
    fail(
      "directive_lineage",
      "No-progress request has invalid lineage",
      eventSeq,
    );
  }
  state.noProgress = {
    phase: "requested",
    id: decoded.decisionId,
    contentSha256: decoded.contentSha256,
    delivered: false,
    requestedTurn: Number(value["requestedTurn"]),
    failureDomainBaseline: Number(value["failureDomainBaseline"]),
    unclassifiedActivityBaseline: Number(value["unclassifiedActivityBaseline"]),
    instructionSha256: String(value["instructionSha256"]),
    phaseTurn: vector.turnIndex,
  };
}

function applyNoProgressOutcome(
  state: MutableRunProgressDirectiveProjection,
  kind: Exclude<
    ValidatedRunProgressDecisionKind,
    | "legacy_action_first"
    | "convergence_request"
    | "convergence_activate"
    | "convergence_reopen"
    | "no_progress_request"
  >,
  decoded: ValidatedRunProgressDecision,
  value: JsonObject,
  vector: ValidatedRunProgressVector,
  eventSeq: number,
): void {
  const noProgress = state.noProgress;
  validateNoProgressParent(noProgress, value, vector, eventSeq);
  validateNoProgressTransition(noProgress, kind, eventSeq);
  validateNoProgressVector(
    state.policy,
    noProgress,
    kind,
    value,
    vector,
    eventSeq,
  );
  if (
    (kind === "no_progress_repair" ||
      kind === "no_progress_observability_degraded" ||
      kind === "no_progress_halt") &&
    !noProgress.delivered
  ) {
    fail(
      "directive_lineage",
      "No-progress outcome precedes directive delivery",
      eventSeq,
    );
  }
  if (kind === "no_progress_resolve") state.noProgress = { phase: "idle" };
  else if (kind === "no_progress_repair") {
    state.noProgress = {
      ...noProgress,
      phase: "repair",
      phaseTurn: vector.turnIndex,
    };
  } else if (kind === "no_progress_observability_degraded") {
    state.noProgress = {
      ...noProgress,
      phase: "observability_degraded",
      phaseTurn: vector.turnIndex,
      leaseThroughTurn: Number(value["leaseThroughTurn"]),
      decisionId: decoded.decisionId,
    };
  } else {
    state.noProgress = {
      ...noProgress,
      phase: "halted",
      phaseTurn: vector.turnIndex,
    };
  }
}

function validateNoProgressParent(
  noProgress: CodecNoProgressState,
  value: JsonObject,
  vector: ValidatedRunProgressVector,
  eventSeq: number,
): asserts noProgress is Exclude<CodecNoProgressState, { phase: "idle" }> {
  if (
    noProgress.phase === "idle" ||
    vector.turnIndex <= noProgress.phaseTurn ||
    value["directiveId"] !== noProgress.id ||
    value["rerouteContentSha256"] !== noProgress.contentSha256 ||
    value["requestedTurn"] !== noProgress.requestedTurn ||
    value["failureDomainBaseline"] !== noProgress.failureDomainBaseline ||
    value["unclassifiedActivityBaseline"] !==
      noProgress.unclassifiedActivityBaseline
  ) {
    fail(
      "directive_lineage",
      "No-progress outcome has a stale request parent",
      eventSeq,
    );
  }
}

function validateNoProgressTransition(
  noProgress: Exclude<CodecNoProgressState, { phase: "idle" }>,
  kind: string,
  eventSeq: number,
): void {
  if (
    noProgress.phase === "halted" ||
    (noProgress.phase === "repair" && kind === "no_progress_repair") ||
    (noProgress.phase === "observability_degraded" &&
      (kind === "no_progress_repair" ||
        kind === "no_progress_observability_degraded"))
  ) {
    fail(
      "directive_lineage",
      "No-progress outcome transition is not allowed",
      eventSeq,
    );
  }
}

function validateNoProgressVector(
  policy: Readonly<RunConvergencePolicy>,
  noProgress: Exclude<CodecNoProgressState, { phase: "idle" }>,
  kind: string,
  value: JsonObject,
  vector: ValidatedRunProgressVector,
  eventSeq: number,
): void {
  if (
    (kind === "no_progress_resolve") !== vector.progressed ||
    (kind === "no_progress_repair" &&
      vector.failureDomainCountSinceProgress <=
        noProgress.failureDomainBaseline) ||
    (kind === "no_progress_observability_degraded" &&
      vector.unclassifiedActivityCountSinceProgress <=
        noProgress.unclassifiedActivityBaseline) ||
    (kind === "no_progress_observability_degraded" &&
      value["leaseThroughTurn"] !==
        vector.turnIndex + policy.unclassifiedActivityLeaseTurns) ||
    (kind === "no_progress_halt" &&
      noProgress.phase === "observability_degraded" &&
      vector.turnIndex < (noProgress.leaseThroughTurn ?? Infinity))
  ) {
    fail(
      "vector_binding",
      "No-progress outcome disagrees with its bound vector",
      eventSeq,
    );
  }
}

export function materializeValidatedDirectiveState(input: {
  controlEpochId: string;
  controlEpochVectorSha256?: string;
  convergence: CodecConvergenceState;
  noProgress: CodecNoProgressState;
  latestVector?: ValidatedRunProgressVector;
}): RunDirectiveState {
  const convergence: RunDirectiveState["convergence"] =
    input.convergence.phase === "open"
      ? { phase: "open" }
      : input.convergence.phase === "requested"
        ? {
            phase: "requested",
            directiveId: input.convergence.id,
            turnIndex: input.convergence.requestedTurn,
            delivered: input.convergence.delivered,
          }
        : {
            phase: "active",
            directiveId: input.convergence.id,
            requestedTurn: input.convergence.requestedTurn,
            graceThroughTurn:
              input.convergence.graceThroughTurn ??
              input.convergence.requestedTurn,
          };
  return {
    controlEpochId: input.controlEpochId,
    ...(input.controlEpochVectorSha256
      ? { controlEpochVectorSha256: input.controlEpochVectorSha256 }
      : {}),
    convergence,
    noProgress: materializeNoProgress(input.noProgress),
    ...(input.latestVector ? { latestVector: input.latestVector } : {}),
  };
}

function materializeNoProgress(
  input: CodecNoProgressState,
): RunDirectiveState["noProgress"] {
  if (input.phase === "idle") return { phase: "idle" };
  const request = {
    directiveId: input.id,
    turnIndex: input.requestedTurn,
    failureDomainBaseline: input.failureDomainBaseline,
    unclassifiedActivityBaseline: input.unclassifiedActivityBaseline,
    rerouteContentSha256: input.contentSha256,
    delivered: input.delivered,
  };
  if (input.phase === "requested") return { phase: "requested", ...request };
  if (input.phase === "repair") {
    return { phase: "repair", ...request, repairTurn: input.phaseTurn };
  }
  if (input.phase === "observability_degraded") {
    return {
      phase: "observability_degraded",
      ...request,
      decisionId: input.decisionId ?? input.id,
      leaseThroughTurn: input.leaseThroughTurn ?? input.phaseTurn,
    };
  }
  return { phase: "halted", ...request, haltedTurn: input.phaseTurn };
}
