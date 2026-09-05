import type { JsonValue, RunEvent } from "@napier/contracts";

import { operationText } from "./tool-operation-binding.js";
import {
  executionLeaseFromPayload,
  executionLeaseTokenFromPayload,
} from "./tool-operation-execution-lease.js";
import type {
  ToolOperationExecutionLease,
  ToolOperationEventType,
} from "./tool-operation-model.js";

export interface ToolOperationTransitionState {
  proposed?: RunEvent;
  admitted?: RunEvent;
  started?: RunEvent;
  startedEvents: RunEvent[];
  effectBoundary?: RunEvent;
  effectIndeterminate?: RunEvent;
  settled?: RunEvent;
  admission?: "admitted" | "rejected";
  executionLease?: ToolOperationExecutionLease;
}

export function assertValidToolOperationTransition(
  type: ToolOperationEventType,
  state: ToolOperationTransitionState,
  fields: Record<string, JsonValue>,
  operationId: string,
): void {
  if (type === "tool.operation.proposed") return;
  if (!state.proposed) {
    throw lifecycleError(operationId, `${type} requires proposed`);
  }
  if (type === "tool.operation.admitted") {
    assertAdmissionTransition(state, operationId);
    return;
  }
  if (!state.admitted || !state.admission) {
    throw lifecycleError(operationId, `${type} requires admitted`);
  }
  if (type === "tool.operation.lease.granted") {
    assertLeaseGrantTransition(state, fields, operationId);
    return;
  }
  if (type === "tool.operation.lease.renewed") {
    assertLeaseRenewalTransition(state, fields, operationId);
    return;
  }
  if (type === "tool.operation.started") {
    assertStartedTransition(state, fields, operationId);
    return;
  }
  if (type === "tool.operation.effect_indeterminate") {
    assertEffectIndeterminateTransition(state, fields, operationId);
    return;
  }
  assertSettlementTransition(state, fields, operationId);
}

function assertAdmissionTransition(
  state: ToolOperationTransitionState,
  operationId: string,
): void {
  if (state.admitted || state.started || state.settled) {
    throw lifecycleError(operationId, "admission must follow proposed once");
  }
}

function assertLeaseGrantTransition(
  state: ToolOperationTransitionState,
  fields: Record<string, JsonValue>,
  operationId: string,
): void {
  const lease = executionLeaseFromPayload(fields);
  const previous = state.executionLease;
  if (
    state.admission !== "admitted" ||
    state.settled ||
    state.effectIndeterminate ||
    !lease ||
    lease.previousGeneration !== (previous?.generation ?? 0)
  ) {
    throw lifecycleError(
      operationId,
      "execution lease takeover requires the current admitted generation",
    );
  }
  if (
    (state.started && lease.disposition !== "safe_started_takeover") ||
    (!state.started && lease.disposition !== "unstarted_takeover")
  ) {
    throw lifecycleError(
      operationId,
      "execution lease takeover disposition does not match durable start state",
    );
  }
}

function assertLeaseRenewalTransition(
  state: ToolOperationTransitionState,
  fields: Record<string, JsonValue>,
  operationId: string,
): void {
  const lease = executionLeaseFromPayload(fields);
  const previous = state.executionLease;
  if (
    state.admission !== "admitted" ||
    state.settled ||
    state.effectIndeterminate ||
    !lease ||
    lease.disposition !== "renewal" ||
    !previous ||
    lease.generation !== previous.generation ||
    lease.ownerSha256 !== previous.ownerSha256 ||
    lease.expiresAtMs <= previous.expiresAtMs
  ) {
    throw lifecycleError(
      operationId,
      "execution lease renewal requires the current generation and a later expiry",
    );
  }
  if (
    fields["executionEffectBoundary"] !== undefined &&
    (fields["executionEffectBoundary"] !== true || !state.started)
  ) {
    throw lifecycleError(
      operationId,
      "an effect-boundary renewal requires the current generation to be started",
    );
  }
}

function assertStartedTransition(
  state: ToolOperationTransitionState,
  fields: Record<string, JsonValue>,
  operationId: string,
): void {
  const token = executionLeaseTokenFromPayload(fields);
  if (
    state.admission !== "admitted" ||
    state.settled ||
    state.effectIndeterminate
  ) {
    throw lifecycleError(
      operationId,
      "started requires a non-terminal admitted decision",
    );
  }
  if (
    !token ||
    !state.executionLease ||
    token.generation !== state.executionLease.generation ||
    token.ownerSha256 !== state.executionLease.ownerSha256 ||
    state.started
  ) {
    throw lifecycleError(
      operationId,
      "started requires the current unconsumed execution lease generation",
    );
  }
}

function assertEffectIndeterminateTransition(
  state: ToolOperationTransitionState,
  fields: Record<string, JsonValue>,
  operationId: string,
): void {
  const token = executionLeaseTokenFromPayload(fields);
  const boundaryToken = executionLeaseTokenFromPayload(
    state.effectBoundary?.payload,
  );
  if (
    state.admission !== "admitted" ||
    !state.started ||
    !state.executionLease ||
    !state.effectBoundary ||
    state.settled ||
    state.effectIndeterminate ||
    !token ||
    !boundaryToken ||
    fields["effectBoundaryEventSeq"] !== state.effectBoundary.seq ||
    token.generation !== state.executionLease.generation ||
    token.ownerSha256 !== state.executionLease.ownerSha256 ||
    token.generation !== boundaryToken.generation ||
    token.ownerSha256 !== boundaryToken.ownerSha256
  ) {
    throw lifecycleError(
      operationId,
      "effect indeterminate requires the unresolved current effect boundary",
    );
  }
}

function assertSettlementTransition(
  state: ToolOperationTransitionState,
  fields: Record<string, JsonValue>,
  operationId: string,
): void {
  if (state.effectIndeterminate) {
    throw lifecycleError(
      operationId,
      "settlement is fenced by durable effect-indeterminate recovery",
    );
  }
  const outcome = operationText(fields["outcome"]);
  if (state.admission === "rejected") {
    if (
      outcome !== "skipped" ||
      state.startedEvents.length > 0 ||
      executionLeaseTokenFromPayload(fields)
    ) {
      throw lifecycleError(
        operationId,
        "a rejected operation may only settle as skipped without starting",
      );
    }
    return;
  }
  const settlementToken = executionLeaseTokenFromPayload(fields);
  const startedToken = executionLeaseTokenFromPayload(state.started?.payload);
  if (
    !state.started ||
    !state.executionLease ||
    !settlementToken ||
    !startedToken ||
    settlementToken.generation !== startedToken.generation ||
    settlementToken.ownerSha256 !== startedToken.ownerSha256 ||
    settlementToken.generation !== state.executionLease.generation ||
    settlementToken.ownerSha256 !== state.executionLease.ownerSha256
  ) {
    throw lifecycleError(
      operationId,
      "settled requires started with the current execution lease generation",
    );
  }
}

function lifecycleError(operationId: string, message: string): Error {
  return new Error(
    `Tool operation ${operationId} lifecycle violation: ${message}`,
  );
}
