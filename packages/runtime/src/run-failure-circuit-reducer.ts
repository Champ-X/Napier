import type { JsonValue, RunEvent } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  eventRunProgress,
  type RunConvergenceToolProgress,
} from "./run-convergence-tool-progress.js";
import {
  type MutableRunFailureCircuitEntry,
  type ParsedRunFailure,
  type RunFailureCircuitPolicy,
  type RunFailureCircuitProjection,
  type RunFailureCircuitProjectionOptions,
} from "./run-failure-circuit-model.js";
import {
  compareRunCircuitEntries,
  pruneRunCircuitEntries,
  publicRunCircuitEntry,
  recordRunCircuitFailure,
  recordRunCircuitSuccess,
} from "./run-failure-circuit-entry-reducer.js";
import { failureCircuitKey } from "./run-failure-circuit-resolution.js";
import { bindRunFailure } from "./run-failure-circuit-binding.js";
import {
  circuitRecord,
  circuitText,
  failureBinding,
  failureCircuitPolicy,
  isCircuitHash,
  isRunFailureCircuitScope,
  optionalNonnegativeInteger,
  parseRunToolFailure,
} from "./run-failure-circuit-semantics.js";
import { acceptFirstToolTerminal } from "./run-tool-terminal-projection.js";
import { orderedRunEventsThroughTerminal } from "./run-terminal-projection-fence.js";
import { toolExecutionAuthorityOperationIds } from "./tool-execution-authority-binding.js";

interface CircuitProjectionState {
  executionAuthorityOperationIds: ReadonlySet<string>;
  entries: Map<string, MutableRunFailureCircuitEntry>;
  terminalCallIds: Set<string>;
  terminalOperationIds: Set<string>;
  proposedOperationIds: Set<string>;
  admittedOperationIds: Set<string>;
  startedOperationIds: Set<string>;
  circuitRejectedOperationIds: Set<string>;
  operationEpochs: Map<string, number>;
  operationParentCallIds: Map<string, string>;
  completedChildParentCallIds: Set<string>;
  progressByCallId: Map<string, RunConvergenceToolProgress>;
  callEpochs: Map<string, number>;
  attemptIndex: number;
  epoch: number;
  epochStartedAtSeq: number;
  throughSeq: number;
}

/**
 * Reduces typed terminal receipts into independently scoped failure circuits.
 * The result depends only on ordered ledger events and policy; callers provide
 * `asOf` separately when resolving TTL state.
 */
export function projectRunFailureCircuits(
  events: readonly RunEvent[],
  runId: string,
  options: RunFailureCircuitProjectionOptions = {},
): RunFailureCircuitProjection {
  const policy = failureCircuitPolicy(options.policy);
  const policySha256 = sha256(canonicalJson(policy as unknown as JsonValue));
  const ordered = orderedRunEventsThroughTerminal(events, runId);
  const state = initialProjectionState(ordered);
  for (const event of ordered) reduceCircuitEvent(state, event, policy);
  pruneRunCircuitEntries(
    state.entries,
    state.attemptIndex,
    policy.failureWindowEventSpan,
  );
  return {
    schemaVersion: 1,
    runId,
    throughSeq: state.throughSeq,
    epoch: state.epoch,
    epochStartedAtSeq: state.epochStartedAtSeq,
    policySha256,
    entries: [...state.entries.values()]
      .map(publicRunCircuitEntry)
      .sort(compareRunCircuitEntries),
  };
}

function initialProjectionState(
  events: readonly RunEvent[],
): CircuitProjectionState {
  return {
    executionAuthorityOperationIds: toolExecutionAuthorityOperationIds(events),
    entries: new Map(),
    terminalCallIds: new Set(),
    terminalOperationIds: new Set(),
    proposedOperationIds: new Set(),
    admittedOperationIds: new Set(),
    startedOperationIds: new Set(),
    circuitRejectedOperationIds: new Set(),
    operationEpochs: new Map(),
    operationParentCallIds: new Map(),
    completedChildParentCallIds: new Set(),
    progressByCallId: new Map(),
    callEpochs: new Map(),
    attemptIndex: 0,
    epoch: 0,
    epochStartedAtSeq: 0,
    throughSeq: 0,
  };
}

function reduceCircuitEvent(
  state: CircuitProjectionState,
  event: RunEvent,
  policy: RunFailureCircuitPolicy,
): void {
  state.throughSeq = Math.max(state.throughSeq, event.seq);
  if (policy.epochEventTypes.includes(event.type)) {
    startNextEpoch(state, event.seq);
    return;
  }
  const payload = circuitRecord(event.payload);
  const operationId = circuitText(payload?.["operationId"]);
  if (
    event.type.startsWith("tool.operation.") &&
    operationId &&
    state.executionAuthorityOperationIds.has(operationId)
  ) {
    return;
  }
  if (event.type === "tool.operation.proposed") {
    reduceChildProposal(state, payload);
    return;
  }
  if (event.type === "tool.operation.admitted") {
    reduceChildAdmission(state, event, payload);
    return;
  }
  if (event.type === "tool.operation.settled") {
    reduceChildSettlement(state, event, payload, policy);
    return;
  }
  if (event.type === "tool.operation.started") {
    reduceChildStarted(state, payload);
    return;
  }
  reduceParentOperation(state, event, payload, policy);
}

function startNextEpoch(state: CircuitProjectionState, seq: number): void {
  state.epoch += 1;
  state.epochStartedAtSeq = seq;
  state.entries.clear();
  state.terminalCallIds.clear();
  state.terminalOperationIds.clear();
  state.proposedOperationIds.clear();
  state.admittedOperationIds.clear();
  state.startedOperationIds.clear();
  state.circuitRejectedOperationIds.clear();
  state.operationEpochs.clear();
  state.operationParentCallIds.clear();
  state.completedChildParentCallIds.clear();
  state.progressByCallId.clear();
  state.callEpochs.clear();
  state.attemptIndex = 0;
}

function reduceChildProposal(
  state: CircuitProjectionState,
  payload: Record<string, JsonValue> | undefined,
): void {
  const operationId = circuitText(payload?.["operationId"]);
  const parentCallId = circuitText(payload?.["parentCallId"]);
  if (
    !operationId ||
    !parentCallId ||
    state.proposedOperationIds.has(operationId)
  ) {
    return;
  }
  state.proposedOperationIds.add(operationId);
  state.operationEpochs.set(operationId, state.epoch);
  state.operationParentCallIds.set(operationId, parentCallId);
}

function reduceChildAdmission(
  state: CircuitProjectionState,
  event: RunEvent,
  payload: Record<string, JsonValue> | undefined,
): void {
  const operationId = circuitText(payload?.["operationId"]);
  if (
    !operationId ||
    !state.proposedOperationIds.has(operationId) ||
    state.operationEpochs.get(operationId) !== state.epoch ||
    state.admittedOperationIds.has(operationId) ||
    state.circuitRejectedOperationIds.has(operationId)
  ) {
    return;
  }
  const rejection = validCircuitRejectionMarker(
    payload,
    operationId,
    event.seq,
  );
  if (payload?.["admission"] === "admitted") {
    state.admittedOperationIds.add(operationId);
  } else if (rejection?.decisionEpoch === state.epoch) {
    // Existing circuit evidence prevented work; this is not a new attempt.
    state.circuitRejectedOperationIds.add(operationId);
  }
}

function reduceChildStarted(
  state: CircuitProjectionState,
  payload: Record<string, JsonValue> | undefined,
): void {
  const operationId = circuitText(payload?.["operationId"]);
  if (
    operationId &&
    state.operationEpochs.get(operationId) === state.epoch &&
    state.admittedOperationIds.has(operationId) &&
    !state.terminalOperationIds.has(operationId)
  ) {
    state.startedOperationIds.add(operationId);
  }
}

function reduceChildSettlement(
  state: CircuitProjectionState,
  event: RunEvent,
  payload: Record<string, JsonValue> | undefined,
  policy: RunFailureCircuitPolicy,
): void {
  const operationId = circuitText(payload?.["operationId"]);
  if (!currentUnsettledChild(state, operationId)) return;
  const outcome = circuitText(payload?.["outcome"]);
  const rejected = state.circuitRejectedOperationIds.has(operationId);
  const admitted = state.admittedOperationIds.has(operationId);
  if (
    (rejected && outcome !== "skipped") ||
    (!rejected && !admitted) ||
    (admitted &&
      outcome !== "skipped" &&
      !state.startedOperationIds.has(operationId))
  ) {
    return;
  }
  const progress = childOperationProgress(payload);
  if (!progress) return;
  state.terminalOperationIds.add(operationId);
  const parentCallId = state.operationParentCallIds.get(operationId);
  if (parentCallId) state.completedChildParentCallIds.add(parentCallId);
  if (rejected || outcome === "skipped") return;
  advanceAttemptWindow(state, policy);
  if (outcome === "succeeded") {
    recordRunCircuitSuccess(
      state.entries,
      progress,
      event.seq,
      state.epoch,
      policy,
    );
    return;
  }
  if (outcome !== "failed") return;
  const failure = parseRunToolFailure(payload?.["failure"], payload);
  if (!failure) return;
  applyBoundFailure(state, failure, progress, operationId, event, policy);
}

function currentUnsettledChild(
  state: CircuitProjectionState,
  operationId: string | undefined,
): operationId is string {
  return Boolean(
    operationId &&
    !state.terminalOperationIds.has(operationId) &&
    state.operationEpochs.get(operationId) === state.epoch,
  );
}

function reduceParentOperation(
  state: CircuitProjectionState,
  event: RunEvent,
  payload: Record<string, JsonValue> | undefined,
  policy: RunFailureCircuitPolicy,
): void {
  const callId = circuitText(payload?.["callId"]);
  const eventProgress = eventRunProgress(payload);
  if (event.type === "tool.started" && callId && eventProgress) {
    state.progressByCallId.set(callId, eventProgress);
    state.callEpochs.set(callId, state.epoch);
    return;
  }
  if (!acceptFirstToolTerminal(event, payload, state.terminalCallIds)) return;
  if (callId && state.completedChildParentCallIds.has(callId)) return;
  if (!currentCallEpoch(state, callId)) return;
  const progress =
    eventProgress ?? (callId ? state.progressByCallId.get(callId) : undefined);
  if (!progress) return;
  advanceAttemptWindow(state, policy);
  if (event.type === "tool.completed") {
    recordRunCircuitSuccess(
      state.entries,
      progress,
      event.seq,
      state.epoch,
      policy,
    );
    return;
  }
  if (event.type !== "tool.failed" && event.type !== "tool.blocked") return;
  const failure = parseRunToolFailure(payload?.["toolFailure"], payload);
  if (failure)
    applyBoundFailure(state, failure, progress, callId, event, policy);
}

function currentCallEpoch(
  state: CircuitProjectionState,
  callId: string | undefined,
): boolean {
  if (!callId) return true;
  const callEpoch = state.callEpochs.get(callId);
  return callEpoch === undefined || callEpoch === state.epoch;
}

function advanceAttemptWindow(
  state: CircuitProjectionState,
  policy: RunFailureCircuitPolicy,
): void {
  state.attemptIndex += 1;
  pruneRunCircuitEntries(
    state.entries,
    state.attemptIndex,
    policy.failureWindowEventSpan,
  );
}

function applyBoundFailure(
  state: CircuitProjectionState,
  failure: ParsedRunFailure,
  progress: RunConvergenceToolProgress,
  callId: string | undefined,
  event: RunEvent,
  policy: RunFailureCircuitPolicy,
): void {
  const bound = bindRunFailure(failure, progress, callId);
  if (bound) {
    recordRunCircuitFailure(
      state.entries,
      bound.failure,
      bound.bindingSha256,
      event,
      state.epoch,
      state.attemptIndex,
      policy,
    );
  }
}

function childOperationProgress(
  payload: Record<string, JsonValue> | undefined,
): RunConvergenceToolProgress | undefined {
  const operation = circuitText(payload?.["operation"]);
  const contribution = circuitText(payload?.["contribution"]);
  if (
    !validProgressOperation(operation) ||
    !validProgressContribution(contribution)
  ) {
    return undefined;
  }
  const resourceCandidate = payload?.["resourceKeySha256"];
  const failureBindings = circuitFailureBindings(payload?.["failureBindings"]);
  const domainCandidate = payload?.["failureDomainKeySha256"];
  const resourceKeySha256 = isCircuitHash(resourceCandidate)
    ? resourceCandidate
    : undefined;
  const failureDomainKeySha256 = isCircuitHash(domainCandidate)
    ? domainCandidate
    : undefined;
  return {
    availability: "declared",
    coverage: "trusted_declared",
    operation,
    contribution,
    ...(resourceKeySha256 ? { resourceKeySha256 } : {}),
    ...(failureBindings ? { failureBindings } : {}),
    ...(failureDomainKeySha256 ? { failureDomainKeySha256 } : {}),
  };
}

function circuitFailureBindings(
  value: JsonValue | undefined,
): RunConvergenceToolProgress["failureBindings"] | undefined {
  const candidate = circuitRecord(value);
  if (!candidate) return undefined;
  const bindings = Object.fromEntries(
    (["target", "origin", "route", "capability", "session"] as const).flatMap(
      (scope) => {
        const binding = candidate[scope];
        return isCircuitHash(binding) ? [[scope, binding] as const] : [];
      },
    ),
  );
  return Object.keys(bindings).length > 0 ? bindings : undefined;
}

function validProgressOperation(
  value: string | undefined,
): value is RunConvergenceToolProgress["operation"] {
  return Boolean(
    value &&
    [
      "acquire",
      "reuse",
      "observe",
      "mutate",
      "verify",
      "coordinate",
      "neutral",
    ].includes(value),
  );
}

function validProgressContribution(
  value: string | undefined,
): value is RunConvergenceToolProgress["contribution"] {
  return Boolean(
    value &&
    ["supporting", "product", "verification", "control", "neutral"].includes(
      value,
    ),
  );
}

function validCircuitRejectionMarker(
  payload: Record<string, JsonValue> | undefined,
  operationId: string,
  admissionSeq: number,
): { decisionEpoch: number } | undefined {
  if (!isCircuitRejection(payload)) return undefined;
  const scope = circuitText(payload["circuitScope"]);
  const keyCandidate = payload["circuitKeySha256"];
  const keySha256 = isCircuitHash(keyCandidate) ? keyCandidate : undefined;
  const decisionEpoch = optionalNonnegativeInteger(payload["circuitEpoch"]);
  const throughSeq = optionalNonnegativeInteger(payload["circuitThroughSeq"]);
  const progress = childOperationProgress(payload);
  if (
    !scope ||
    !isRunFailureCircuitScope(scope) ||
    !keySha256 ||
    decisionEpoch === undefined ||
    throughSeq === undefined ||
    throughSeq >= admissionSeq ||
    !progress
  ) {
    return undefined;
  }
  const bindingSha256 = failureBinding(scope, progress, operationId);
  return bindingSha256 && failureCircuitKey(scope, bindingSha256) === keySha256
    ? { decisionEpoch }
    : undefined;
}

function isCircuitRejection(
  payload: Record<string, JsonValue> | undefined,
): payload is Record<string, JsonValue> {
  return (
    payload?.["admission"] === "rejected" &&
    payload["admissionSource"] === "failure_circuit" &&
    payload["circuitStatus"] === "open"
  );
}
