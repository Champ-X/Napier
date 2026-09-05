import type { JsonObject, JsonValue, RunEvent } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { ResolvedRunFailureCircuit } from "./run-failure-circuit-projection.js";
import {
  isOperationFailureCircuitScope,
  operationFailure,
  operationHash,
  operationNonNegativeInteger,
  operationObject,
  operationText,
  stableOperationBinding,
  type BoundToolOperationDescriptor,
} from "./tool-operation-binding.js";
import {
  executionLeaseFromPayload,
  executionLeaseTokenFromPayload,
} from "./tool-operation-execution-lease.js";
import { assertValidToolOperationTransition } from "./tool-operation-transition-validation.js";
import type {
  ToolOperationAdmissionDecision,
  ToolOperationExecutionLease,
  ToolOperationEventType,
  ToolOperationSettlement,
} from "./tool-operation-model.js";

export interface ToolOperationJournalCoordinator {
  events: RunEvent[];
  throughSeq: number;
  queue: Promise<void>;
}

export interface ToolOperationLedgerState {
  proposed?: RunEvent;
  admitted?: RunEvent;
  started?: RunEvent;
  startedEvents: RunEvent[];
  /** Current generation durably entered code that may produce effects. */
  effectBoundary?: RunEvent;
  /** Recovery durably closed authority without claiming a known result. */
  effectIndeterminate?: RunEvent;
  settled?: RunEvent;
  admission?: "admitted" | "rejected";
  admissionSource?: "caller" | "failure_circuit";
  executionLease?: ToolOperationExecutionLease;
}

const coordinators = new WeakMap<
  object,
  Map<string, ToolOperationJournalCoordinator>
>();

export function toolOperationCoordinator(
  store: object,
  runId: string,
): ToolOperationJournalCoordinator {
  let runs = coordinators.get(store);
  if (!runs) {
    runs = new Map();
    coordinators.set(store, runs);
  }
  const existing = runs.get(runId);
  if (existing) return existing;
  const coordinator = {
    events: [],
    throughSeq: 0,
    queue: Promise.resolve(),
  };
  runs.set(runId, coordinator);
  return coordinator;
}

export function toolOperationSettlementFields(
  input: ToolOperationSettlement,
): Record<string, JsonValue> {
  const failure =
    input.outcome === "succeeded"
      ? undefined
      : operationFailure(input.diagnostic, input.details, input.failure);
  const stateSha256 = stableOperationBinding(input.state);
  const effectSha256 =
    stableOperationBinding(input.effect) ??
    sha256(
      canonicalJson({
        outcome: input.outcome,
        stateSha256: stateSha256 ?? "",
        failure: failure ?? null,
      }),
    );
  return {
    outcome: input.outcome,
    effectSha256,
    ...(stateSha256 ? { stateSha256 } : {}),
    ...(failure ? { failure } : {}),
  };
}

export function toolOperationEventPayload(
  binding: BoundToolOperationDescriptor,
  phaseStateSha256: string,
  fields: Record<string, JsonValue>,
): JsonObject {
  return {
    kind: "napier.tool-operation",
    schemaVersion: 1,
    parentCallId: binding.parentCallId,
    operationId: binding.operationId,
    ...(binding.descriptor.role ? { role: binding.descriptor.role } : {}),
    ...(binding.descriptor.startedTakeover
      ? { startedTakeover: binding.descriptor.startedTakeover }
      : {}),
    ordinal: binding.descriptor.ordinal,
    mode: binding.descriptor.mode,
    route: binding.descriptor.route,
    operation: binding.descriptor.operation,
    scope: binding.descriptor.scope,
    contribution: binding.descriptor.contribution,
    resourceKeySha256: binding.resourceKeySha256,
    ...(binding.failureBindings
      ? { failureBindings: binding.failureBindings }
      : {}),
    ...(binding.failureDefinitionSha256
      ? { failureDefinitionSha256: binding.failureDefinitionSha256 }
      : {}),
    failureDomainKeySha256: binding.failureDomainKeySha256,
    descriptorSha256: binding.descriptorSha256,
    phaseStateSha256,
    ...fields,
  };
}

export function findToolOperationPhase(
  events: readonly RunEvent[],
  type: ToolOperationEventType,
  operationId: string,
  fields: Record<string, JsonValue> = {},
): RunEvent | undefined {
  const generation = operationNonNegativeInteger(
    fields["executionLeaseGeneration"],
  );
  const expiresAtMs = operationNonNegativeInteger(
    fields["executionLeaseExpiresAtMs"],
  );
  return events.find(
    (event) =>
      event.type === type &&
      operationObject(event.payload)?.["operationId"] === operationId &&
      (generation === undefined ||
        operationObject(event.payload)?.["executionLeaseGeneration"] ===
          generation) &&
      (type !== "tool.operation.lease.renewed" ||
        operationObject(event.payload)?.["executionLeaseExpiresAtMs"] ===
          expiresAtMs),
  );
}

export function toolOperationLedgerState(
  events: readonly RunEvent[],
  operationId: string,
): ToolOperationLedgerState {
  const state = collectToolOperationPhases(events, operationId);
  applyToolOperationAdmission(state);
  const executionLease = latestToolOperationLease(
    events,
    operationId,
    state.admission === "admitted"
      ? executionLeaseFromPayload(state.admitted?.payload)
      : undefined,
  );
  if (executionLease) state.executionLease = executionLease;
  const currentLease = state.executionLease;
  const currentStart = currentLease
    ? currentToolOperationStart(state.startedEvents, currentLease)
    : state.startedEvents[0];
  if (currentStart) state.started = currentStart;
  if (currentStart && currentLease) {
    const effectBoundary = currentToolEffectBoundary(
      events,
      currentStart,
      currentLease,
    );
    if (effectBoundary) state.effectBoundary = effectBoundary;
  }
  return state;
}

function collectToolOperationPhases(
  events: readonly RunEvent[],
  operationId: string,
): ToolOperationLedgerState {
  const state: ToolOperationLedgerState = { startedEvents: [] };
  for (const event of events) {
    if (operationObject(event.payload)?.["operationId"] !== operationId) {
      continue;
    }
    if (event.type === "tool.operation.proposed") state.proposed ??= event;
    if (event.type === "tool.operation.admitted") state.admitted ??= event;
    if (event.type === "tool.operation.started")
      state.startedEvents.push(event);
    if (event.type === "tool.operation.effect_indeterminate")
      state.effectIndeterminate ??= event;
    if (event.type === "tool.operation.settled") state.settled ??= event;
  }
  return state;
}

function applyToolOperationAdmission(state: ToolOperationLedgerState): void {
  const admissionPayload = operationObject(state.admitted?.payload);
  const admission = operationText(admissionPayload?.["admission"]);
  if (admission === "admitted" || admission === "rejected") {
    state.admission = admission;
    state.admissionSource =
      admissionPayload?.["admissionSource"] === "failure_circuit"
        ? "failure_circuit"
        : "caller";
  }
}

function latestToolOperationLease(
  events: readonly RunEvent[],
  operationId: string,
  initial: ToolOperationExecutionLease | undefined,
): ToolOperationExecutionLease | undefined {
  let current = initial;
  for (const event of events) {
    if (
      (event.type !== "tool.operation.lease.granted" &&
        event.type !== "tool.operation.lease.renewed") ||
      operationObject(event.payload)?.["operationId"] !== operationId
    ) {
      continue;
    }
    const lease = executionLeaseFromPayload(event.payload);
    if (lease && laterExecutionLease(lease, current)) current = lease;
  }
  return current;
}

function laterExecutionLease(
  candidate: ToolOperationExecutionLease,
  current: ToolOperationExecutionLease | undefined,
): boolean {
  return (
    !current ||
    candidate.generation > current.generation ||
    (candidate.generation === current.generation &&
      candidate.expiresAtMs > current.expiresAtMs)
  );
}

function currentToolOperationStart(
  startedEvents: readonly RunEvent[],
  currentLease: ToolOperationExecutionLease,
): RunEvent | undefined {
  return startedEvents.findLast((event) => {
    const token = executionLeaseTokenFromPayload(event.payload);
    return (
      token?.generation === currentLease.generation &&
      token.ownerSha256 === currentLease.ownerSha256
    );
  });
}

function currentToolEffectBoundary(
  events: readonly RunEvent[],
  started: RunEvent,
  lease: ToolOperationExecutionLease,
): RunEvent | undefined {
  return events.findLast((event) => {
    if (event.type !== "tool.operation.lease.renewed") return false;
    const payload = operationObject(event.payload);
    const renewed = executionLeaseFromPayload(payload);
    return (
      event.seq > started.seq &&
      payload?.["executionEffectBoundary"] === true &&
      payload["role"] === "execution_authority" &&
      renewed?.generation === lease.generation &&
      renewed.ownerSha256 === lease.ownerSha256
    );
  });
}

export function assertToolOperationTransition(
  type: ToolOperationEventType,
  state: ToolOperationLedgerState,
  fields: Record<string, JsonValue>,
  operationId: string,
): void {
  assertValidToolOperationTransition(type, state, fields, operationId);
}

export function assertToolOperationPhaseState(
  event: RunEvent,
  expected: string,
  operationId: string,
): void {
  if (operationObject(event.payload)?.["phaseStateSha256"] !== expected) {
    throw new Error(
      `Tool operation replay conflict for ${operationId} ${event.type}`,
    );
  }
}

export function circuitRejectionDecision(
  reason: string,
  circuit: ResolvedRunFailureCircuit,
): ToolOperationAdmissionDecision {
  return {
    admitted: false,
    source: "failure_circuit",
    disposition: "rejected",
    reason,
    circuit: {
      keySha256: circuit.keySha256,
      scope: circuit.scope,
      status: circuit.status,
      ...(circuit.retryAfterMs !== undefined
        ? { retryAfterMs: circuit.retryAfterMs }
        : {}),
    },
  };
}

export function replayedAdmissionDecision(
  admission: "admitted" | "rejected",
  source: "caller" | "failure_circuit",
  payload: Record<string, JsonValue>,
): ToolOperationAdmissionDecision {
  const scope = operationText(payload["circuitScope"]);
  const keySha256 = operationHash(payload["circuitKeySha256"]);
  const retryAfterMs = operationNonNegativeInteger(
    payload["circuitRetryAfterMs"],
  );
  return {
    admitted: false,
    source,
    disposition: "rejected",
    ...(admission === "rejected"
      ? {
          reason:
            source === "failure_circuit"
              ? `Failure circuit is open for ${scope ?? "binding"}`
              : "Operation was rejected by its caller",
        }
      : {}),
    ...(source === "failure_circuit" &&
    scope &&
    keySha256 &&
    isOperationFailureCircuitScope(scope)
      ? {
          circuit: {
            keySha256,
            scope,
            status: "open" as const,
            ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
          },
        }
      : {}),
  };
}

export function executableAdmissionDecision(
  source: "caller" | "failure_circuit",
  executionLease?: ToolOperationExecutionLease,
): ToolOperationAdmissionDecision {
  return {
    admitted: true,
    source,
    disposition: "execute",
    ...(executionLease ? { executionLease } : {}),
  };
}

export function inFlightReplayDecision(
  executionLease?: ToolOperationExecutionLease,
): ToolOperationAdmissionDecision {
  return {
    admitted: false,
    source: "replay",
    disposition: "in_flight_replay",
    reason: "This exact operation is already admitted or running",
    ...(executionLease ? { executionLease } : {}),
  };
}

export function indeterminateReplayDecision(): ToolOperationAdmissionDecision {
  return {
    admitted: false,
    source: "replay",
    disposition: "indeterminate_replay",
    reason:
      "The prior execution started with side effects that cannot be safely repeated",
  };
}

export function staleEpochReplayDecision(): ToolOperationAdmissionDecision {
  return {
    admitted: false,
    source: "replay",
    disposition: "stale_epoch_replay",
    reason: "This operation admission belongs to an earlier control epoch",
  };
}

export function terminalReplayDecision(
  event: RunEvent,
): ToolOperationAdmissionDecision {
  const payload = operationObject(event.payload);
  const outcome = operationText(payload?.["outcome"]);
  const effectSha256 = operationHash(payload?.["effectSha256"]);
  const stateSha256 = operationHash(payload?.["stateSha256"]);
  if (
    (outcome !== "succeeded" &&
      outcome !== "failed" &&
      outcome !== "skipped") ||
    !effectSha256
  ) {
    throw new Error(`Invalid terminal tool operation event ${event.id}`);
  }
  return {
    admitted: false,
    source: "replay",
    disposition: "terminal_replay",
    reason: `This exact operation already settled as ${outcome}`,
    terminal: {
      outcome,
      effectSha256,
      ...(stateSha256 ? { stateSha256 } : {}),
    },
  };
}

export function assertToolOperationParentCallId(value: string): void {
  if (!value.trim() || value.length > 256) {
    throw new Error(
      "Tool operation parentCallId must contain 1-256 characters",
    );
  }
}
