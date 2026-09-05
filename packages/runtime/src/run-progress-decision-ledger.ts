import type { JsonObject, RunEvent } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { RunConvergencePolicy } from "./run-convergence-policy.js";
import { projectRunControlEpochs } from "./run-progress-control-epoch-codec.js";
import {
  currentDecisionKind,
  decodeCurrentRunProgressDecision,
  upcastLegacyRunProgressDecisionV1,
} from "./run-progress-decision-schema.js";
import {
  applyValidatedCurrentDecision,
  applyValidatedDirectiveDelivery,
  materializeValidatedDirectiveState,
  type MutableRunProgressDirectiveProjection,
} from "./run-progress-decision-state.js";
import {
  fail,
  isDecisionEvent,
  object,
  orderedRunEvents,
  validateEnvelopeSchema,
  validateOperatorEpoch,
} from "./run-progress-payload-primitives.js";
import type {
  ValidatedRunProgressDecision,
  ValidatedRunProgressLedger,
  ValidatedRunProgressVector,
} from "./run-progress-payload-types.js";
import { projectValidatedVectorChain } from "./run-progress-vector-chain.js";

interface ProjectionState extends MutableRunProgressDirectiveProjection {
  runId: string;
  expectedPolicySha256: string;
  vectorByEventSeq: ReadonlyMap<number, ValidatedRunProgressVector>;
  controlEpochByEventSeq: ReadonlyMap<
    number,
    { controlEpochId: string; boundarySeq: number }
  >;
  latestVector: ValidatedRunProgressVector | undefined;
  controlEpochId: string;
  controlEpochBoundarySeq: number;
  controlEpochVectorSha256: string | undefined;
  decisions: ValidatedRunProgressDecision[];
  decisionIds: Set<string>;
}

/** Validates the whole decision stream and materializes its directive state. */
export function projectValidatedRunProgressLedger(
  events: readonly RunEvent[],
  runId: string,
  policy: Readonly<RunConvergencePolicy>,
): ValidatedRunProgressLedger {
  const ordered = orderedRunEvents(events, runId);
  const vectors = projectValidatedVectorChain(ordered, runId);
  const controlEpochs = projectRunControlEpochs(ordered);
  const state: ProjectionState = {
    runId,
    policy,
    expectedPolicySha256: sha256(canonicalJson(policy)),
    vectorByEventSeq: new Map(
      vectors.map((vector) => [vector.eventSeq, vector]),
    ),
    controlEpochByEventSeq: new Map(
      controlEpochs.map((epoch) => [epoch.eventSeq, epoch]),
    ),
    latestVector: undefined,
    controlEpochId: `${runId}:initial`,
    controlEpochBoundarySeq: 0,
    controlEpochVectorSha256: undefined,
    convergence: { phase: "open" },
    noProgress: { phase: "idle" },
    decisions: [],
    decisionIds: new Set(),
  };
  for (const event of ordered) consumeEvent(state, event);
  return {
    vectors,
    decisions: state.decisions,
    controlEpochId: state.controlEpochId,
    directiveState: materializeValidatedDirectiveState({
      controlEpochId: state.controlEpochId,
      ...(state.controlEpochVectorSha256
        ? { controlEpochVectorSha256: state.controlEpochVectorSha256 }
        : {}),
      convergence: state.convergence,
      noProgress: state.noProgress,
      ...(state.latestVector?.decisionEligible === true
        ? { latestVector: state.latestVector }
        : {}),
    }),
  };
}

function consumeEvent(state: ProjectionState, event: RunEvent): void {
  const vector = state.vectorByEventSeq.get(event.seq);
  if (vector) {
    state.latestVector = vector;
    return;
  }
  if (event.type === "run.control.delivered") {
    const epoch = state.controlEpochByEventSeq.get(event.seq);
    if (!epoch) {
      fail(
        "control_epoch_lineage",
        "Run control delivery is missing its validated lifecycle",
        event.seq,
      );
    }
    resetControlEpoch(state, epoch.controlEpochId, epoch.boundarySeq);
    return;
  }
  if (event.type === "run.progress.operator_epoch") {
    const controlEpochId = validateOperatorEpoch(event, state.controlEpochId);
    resetControlEpoch(state, controlEpochId, event.seq);
    return;
  }
  if (event.type === "run.progress.directive.delivered") {
    applyValidatedDirectiveDelivery(state, event);
    return;
  }
  if (isDecisionEvent(event.type)) consumeDecision(state, event);
}

function resetControlEpoch(
  state: ProjectionState,
  controlEpochId: string,
  boundarySeq: number,
): void {
  state.controlEpochId = controlEpochId;
  state.controlEpochBoundarySeq = boundarySeq;
  state.controlEpochVectorSha256 = state.latestVector?.contentSha256;
  state.convergence = { phase: "open" };
  state.noProgress = { phase: "idle" };
}

function consumeDecision(state: ProjectionState, event: RunEvent): void {
  validateEnvelopeSchema(event);
  const vector = state.latestVector;
  if (!vector) {
    fail(
      "vector_binding",
      "Run progress decision precedes every vector",
      event.seq,
    );
  }
  const value = object(event.payload, event.seq);
  const isCurrent = value["policyVersion"] === 1;
  if (isCurrent && !vector.decisionEligible) {
    fail(
      "vector_binding",
      "Current Run progress decision requires a current v2 vector",
      event.seq,
    );
  }
  if (state.controlEpochVectorSha256 === vector.contentSha256) {
    fail(
      "control_epoch_lineage",
      "Run progress decision reuses a vector from before the active control epoch",
      event.seq,
    );
  }
  if (vector.turnCompletedSeq <= state.controlEpochBoundarySeq) {
    fail(
      "control_epoch_lineage",
      "Run progress decision uses observations from before the active control epoch",
      event.seq,
    );
  }
  const decoded = isCurrent
    ? consumeCurrentDecision(state, event, value, vector)
    : consumeLegacyDecision(state, event, vector);
  if (state.decisionIds.has(decoded.decisionId)) {
    fail("decision_identity", "Duplicate Run progress decisionId", event.seq);
  }
  state.decisionIds.add(decoded.decisionId);
  state.decisions.push(decoded);
}

function consumeLegacyDecision(
  state: ProjectionState,
  event: RunEvent,
  vector: ValidatedRunProgressVector,
): ValidatedRunProgressDecision {
  if (
    vector.sourceSchemaVersion !== 1 ||
    state.controlEpochId !== `${state.runId}:initial`
  ) {
    fail(
      "control_epoch_lineage",
      "Legacy Run progress decision cannot cross a current vector or control epoch",
      event.seq,
    );
  }
  const decoded = upcastLegacyRunProgressDecisionV1(event, vector);
  // Compatibility receipts remain visible for audit, but cannot materialize
  // current control state or cause a directive to be delivered after upgrade.
  return decoded;
}

function consumeCurrentDecision(
  state: ProjectionState,
  event: RunEvent,
  value: JsonObject,
  vector: ValidatedRunProgressVector,
): ValidatedRunProgressDecision {
  const kind = currentDecisionKind(event, value);
  const lineageId =
    state.noProgress.phase !== "idle"
      ? state.noProgress.id
      : state.convergence.phase === "open"
        ? "open"
        : state.convergence.id;
  const decoded = decodeCurrentRunProgressDecision(event, value, {
    latestVector: vector,
    expectedPolicySha256: state.expectedPolicySha256,
    policy: state.policy,
    controlEpochId: state.controlEpochId,
    lineageId,
  });
  applyValidatedCurrentDecision(state, kind, decoded, value, vector, event.seq);
  return decoded;
}
