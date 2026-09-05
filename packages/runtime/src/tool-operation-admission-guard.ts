import type { JsonValue, RunEvent } from "@napier/contracts";

import type {
  ResolvedRunFailureCircuit,
  RunFailureCircuitProjection,
} from "./run-failure-circuit-projection.js";
import {
  guardRunFailureCircuit,
  projectRunFailureCircuits,
} from "./run-failure-circuit-projection.js";
import {
  operationHash,
  operationNonNegativeInteger,
  operationObject,
  operationText,
  type BoundToolOperationDescriptor,
} from "./tool-operation-binding.js";
import { toolOperationLedgerState } from "./tool-operation-ledger-support.js";
import { executionLeaseExpired } from "./tool-operation-execution-lease.js";
import { toolExecutionAuthorityOperationIds } from "./tool-execution-authority-binding.js";
import type { ToolOperationJournalOptions } from "./tool-operation-model.js";

export interface ToolOperationAdmissionGuard {
  projection: RunFailureCircuitProjection;
  circuit?: ResolvedRunFailureCircuit;
  activeProbe: boolean;
  asOfMs: number;
}

export interface OpenToolOperationCircuitDecision {
  circuit: ResolvedRunFailureCircuit;
  epoch: number;
  policySha256: string;
  throughSeq: number;
  asOfMs: number;
}

export function projectToolOperationAdmissionGuard(input: {
  events: readonly RunEvent[];
  runId: string;
  binding: BoundToolOperationDescriptor;
  options: ToolOperationJournalOptions;
  asOfMs: number;
}): ToolOperationAdmissionGuard {
  const projection = projectRunFailureCircuits(
    input.events,
    input.runId,
    input.options.failureCircuit,
  );
  const circuit =
    input.binding.descriptor.role !== "execution_authority" &&
    input.binding.descriptor.operation === "acquire"
      ? guardRunFailureCircuit(
          projection,
          {
            resourceKeySha256: input.binding.resourceKeySha256,
            ...(input.binding.failureBindings
              ? { failureBindings: input.binding.failureBindings }
              : {}),
            failureDomainKeySha256: input.binding.failureDomainKeySha256,
          },
          input.asOfMs,
        )
      : undefined;
  return {
    projection,
    ...(circuit ? { circuit } : {}),
    activeProbe: Boolean(
      circuit?.status === "half_open" &&
      hasActiveProbe(input.events, projection, circuit, input.asOfMs),
    ),
    asOfMs: input.asOfMs,
  };
}

export function halfOpenProbeFields(
  guard: ToolOperationAdmissionGuard,
): Record<string, JsonValue> {
  const circuit = guard.circuit;
  return circuit?.status === "half_open" && !guard.activeProbe
    ? {
        circuitProbeKeySha256: circuit.keySha256,
        circuitProbeEpoch: guard.projection.epoch,
        circuitProbeRecoveryEpoch: circuit.recoveryEpoch,
      }
    : {};
}

export function activeProbeBlocker(
  guard: ToolOperationAdmissionGuard,
): ResolvedRunFailureCircuit | undefined {
  const circuit = guard.circuit;
  return circuit?.status === "half_open" && guard.activeProbe
    ? { ...circuit, status: "open", blocks: true }
    : undefined;
}

function hasActiveProbe(
  events: readonly RunEvent[],
  projection: RunFailureCircuitProjection,
  circuit: ResolvedRunFailureCircuit,
  asOfMs: number,
): boolean {
  const authorityOperationIds = toolExecutionAuthorityOperationIds(events);
  return events.some((event) => {
    if (event.type !== "tool.operation.admitted") return false;
    const payload = operationObject(event.payload);
    const operationId = operationText(payload?.["operationId"]);
    if (
      !operationId ||
      authorityOperationIds.has(operationId) ||
      payload?.["admission"] !== "admitted" ||
      operationHash(payload["circuitProbeKeySha256"]) !== circuit.keySha256 ||
      operationNonNegativeInteger(payload["circuitProbeEpoch"]) !==
        projection.epoch ||
      operationNonNegativeInteger(payload["circuitProbeRecoveryEpoch"]) !==
        circuit.recoveryEpoch ||
      event.seq <= (circuit.openedAtSeq ?? 0)
    ) {
      return false;
    }
    const state = toolOperationLedgerState(events, operationId);
    return Boolean(
      !state.settled &&
      state.executionLease &&
      !executionLeaseExpired(state.executionLease, asOfMs),
    );
  });
}
