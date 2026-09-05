import type { JsonObject } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  noProgressReason,
  runNoProgressMessage,
  type RunAcquisitionPhase,
  type RunConvergencePolicy,
} from "./run-convergence-policy.js";
import type {
  RunDirectiveDecision,
  RunDirectiveState,
} from "./run-progress-directive-state.js";

export const RUN_CONVERGENCE_MESSAGE = [
  "Internal convergence checkpoint: additional acquisition no longer has sufficient marginal value for this Run.",
  "Do not start another operation whose declared progress is acquisition-only. Reuse retained evidence and continue with operations that advance, verify, or deliver the product.",
  "Complete, verify, and deliver the best concrete result now. If the full result is impossible, deliver the strongest useful partial result and name the exact remaining blocker.",
].join("\n");

export interface RunDecisionReceipt {
  type:
    | "run.progress.convergence_requested"
    | "run.progress.convergence_activated"
    | "run.progress.convergence_reopened"
    | "run.progress.rerouted";
  payload: JsonObject;
  directive?: {
    id: string;
    message: string;
    kind: "convergence" | "no_progress";
  };
}

export function createRunDecisionReceipt(input: {
  decision: RunDirectiveDecision;
  state: RunDirectiveState;
  phase: RunAcquisitionPhase;
  taskIntentSha256: string;
  policy: Readonly<RunConvergencePolicy>;
}): RunDecisionReceipt {
  const { decision, state, phase } = input;
  const vector = decision.vector;
  const lineageId = directiveLineageId(state);
  const policySha256 = sha256(canonicalJson(input.policy));
  const decisionId = sha256(
    canonicalJson({
      schemaVersion: 1,
      policyVersion: 1,
      policySha256,
      kind: decision.kind,
      progressVectorSha256: vector.contentSha256,
      lineageId,
      parentControlEpochId: state.controlEpochId,
    }),
  );
  if (decision.kind === "convergence_request") {
    const content = {
      kind: "napier.run-convergence" as const,
      schemaVersion: 1 as const,
      policyVersion: 1 as const,
      policySha256,
      status: "requested" as const,
      decisionId,
      parentControlEpochId: state.controlEpochId,
      reason: decision.reason,
      turnIndex: vector.turnIndex,
      elapsedMs: vector.elapsedMs,
      acquisitionOnlyTurnCount: vector.acquisitionOnlyTurnCount,
      acquisitionStagnantTurnCount: vector.acquisitionStagnantTurnCount,
      supportCount: vector.supportCount,
      acquisitionAttemptCount: vector.acquisitionAttemptCount,
      acquisitionAttemptCountSinceProgress:
        vector.acquisitionAttemptCountSinceProgress,
      acquisitionAdvanceCountSinceProgress:
        vector.acquisitionAdvanceCountSinceProgress,
      acquisitionAttemptCountSinceCheckpoint: phase.attempts,
      acquisitionAdvanceCountSinceCheckpoint: phase.advances,
      failureDomainCountSinceCheckpoint: phase.failureDomains,
      productCount: vector.productCount,
      acceptanceCount: vector.acceptanceCount,
      failureDomainCount: vector.failureDomainCount,
      progressVectorSha256: vector.contentSha256,
      instructionSha256: sha256(RUN_CONVERGENCE_MESSAGE),
    };
    return {
      type: "run.progress.convergence_requested",
      payload: withHash(content),
      directive: {
        id: decisionId,
        message: RUN_CONVERGENCE_MESSAGE,
        kind: "convergence",
      },
    };
  }
  if (decision.kind === "convergence_activate") {
    return {
      type: "run.progress.convergence_activated",
      payload: withHash({
        kind: "napier.run-convergence",
        schemaVersion: 1,
        policyVersion: 1,
        policySha256,
        status: "activated",
        decisionId,
        parentControlEpochId: state.controlEpochId,
        parentDirectiveId: convergenceLineage(state),
        acknowledgedByTurn: vector.turnIndex,
        graceThroughTurn: vector.turnIndex,
        progressVectorSha256: vector.contentSha256,
      }),
    };
  }
  if (decision.kind === "convergence_reopen") {
    return {
      type: "run.progress.convergence_reopened",
      payload: withHash({
        kind: "napier.run-convergence",
        schemaVersion: 1,
        policyVersion: 1,
        policySha256,
        status: "reopened",
        decisionId,
        parentControlEpochId: state.controlEpochId,
        parentDirectiveId: convergenceLineage(state),
        reason: decision.reason,
        turnIndex: vector.turnIndex,
        progressVectorSha256: vector.contentSha256,
        acquisitionAttemptBaseline: 0,
        acquisitionAdvanceBaseline: 0,
        failureDomainBaseline: 0,
      }),
    };
  }
  if (decision.kind === "no_progress_request") {
    const message = runNoProgressMessage(vector);
    const content = {
      kind: "napier.run-progress-reroute" as const,
      schemaVersion: 1 as const,
      policyVersion: 1 as const,
      policySha256,
      status: "requested" as const,
      strategy: "summarize_and_converge" as const,
      decisionId,
      parentControlEpochId: state.controlEpochId,
      directiveId: decisionId,
      reason: noProgressReason(vector, input.policy),
      turnIndex: vector.turnIndex,
      requestedTurn: vector.turnIndex,
      stagnantTurnCount: vector.stagnantTurnCount,
      elapsedMs: vector.elapsedMs,
      stagnantElapsedMs: vector.stagnantElapsedMs,
      thresholdTurns: input.policy.noProgressTurnThreshold,
      thresholdElapsedMs: input.policy.noProgressElapsedMs,
      failureDomainBaseline: vector.failureDomainCountSinceProgress,
      unclassifiedActivityBaseline:
        vector.unclassifiedActivityCountSinceProgress,
      progressVectorSha256: vector.contentSha256,
      instructionSha256: sha256(message),
      taskIntentSha256: input.taskIntentSha256,
    };
    return {
      type: "run.progress.rerouted",
      payload: withHash(content),
      directive: { id: decisionId, message, kind: "no_progress" },
    };
  }
  const request = noProgressLineage(state);
  const status =
    decision.kind === "no_progress_resolve"
      ? "resolved"
      : decision.kind === "no_progress_repair"
        ? "repair"
        : decision.kind === "no_progress_observability_degraded"
          ? "observability_degraded"
          : "halted";
  return {
    type: "run.progress.rerouted",
    payload: withHash({
      kind: "napier.run-progress-reroute",
      schemaVersion: 1,
      policyVersion: 1,
      policySha256,
      status,
      decisionId,
      parentControlEpochId: state.controlEpochId,
      directiveId: request.directiveId,
      requestedTurn: request.turnIndex,
      failureDomainBaseline: request.failureDomainBaseline,
      unclassifiedActivityBaseline: request.unclassifiedActivityBaseline,
      rerouteContentSha256: request.rerouteContentSha256,
      ...(status === "observability_degraded"
        ? {
            leaseThroughTurn:
              vector.turnIndex + input.policy.unclassifiedActivityLeaseTurns,
          }
        : {}),
      turnIndex: vector.turnIndex,
      progressVectorSha256: vector.contentSha256,
    }),
  };
}

function directiveLineageId(state: RunDirectiveState): string {
  if (state.noProgress.phase !== "idle") {
    return state.noProgress.directiveId;
  }
  return state.convergence.phase === "open"
    ? "open"
    : state.convergence.directiveId;
}

function convergenceLineage(state: RunDirectiveState): string {
  if (state.convergence.phase === "open") {
    throw new Error("Convergence outcome requires a durable request lineage");
  }
  return state.convergence.directiveId;
}

function noProgressLineage(state: RunDirectiveState) {
  const current = state.noProgress;
  if (
    current.phase !== "requested" &&
    current.phase !== "repair" &&
    current.phase !== "observability_degraded" &&
    current.phase !== "halted"
  ) {
    throw new Error("No-progress outcome requires a durable request lineage");
  }
  return current;
}

function withHash<T extends JsonObject>(content: T): JsonObject {
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}
