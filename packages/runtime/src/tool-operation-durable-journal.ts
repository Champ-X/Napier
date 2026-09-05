import type { JsonValue, RunEvent } from "@napier/contracts";

import { retryCasConflict } from "./cas-conflict-retry.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  projectRunFailureCircuits,
  type RunFailureCircuitProjection,
} from "./run-failure-circuit-projection.js";
import {
  activeProbeBlocker,
  halfOpenProbeFields,
  projectToolOperationAdmissionGuard,
  type OpenToolOperationCircuitDecision,
  type ToolOperationAdmissionGuard,
} from "./tool-operation-admission-guard.js";
import {
  bindToolOperationDescriptor,
  circuitRejectionEffectSha256,
  normalizeToolOperationDescriptor,
  operationAdmissionTimestamp,
  operationFailure,
  operationFailureFromPayload,
  operationHash,
  operationObject,
  type BoundToolOperationDescriptor,
} from "./tool-operation-binding.js";
import {
  assertToolOperationParentCallId,
  circuitRejectionDecision,
  executableAdmissionDecision,
  indeterminateReplayDecision,
  inFlightReplayDecision,
  replayedAdmissionDecision,
  staleEpochReplayDecision,
  terminalReplayDecision,
  toolOperationCoordinator,
  toolOperationLedgerState,
  type ToolOperationJournalCoordinator,
} from "./tool-operation-ledger-support.js";
import {
  allowsStartedExecutionTakeover,
  executionLeaseExpired,
  executionLeaseFields,
  initialExecutionLease,
  sameExecutionLease,
  toolOperationLeaseIssuer,
  type ToolOperationLeaseIssuer,
} from "./tool-operation-execution-lease.js";
import {
  ToolOperationFencingError,
  ToolOperationExecutionAuthority,
  type LifecycleExecutionAuthority,
} from "./tool-operation-execution-authority.js";
import {
  scheduleToolOperationHeartbeat,
  stopToolOperationHeartbeat,
  type ToolOperationHeartbeatState,
} from "./tool-operation-heartbeat.js";
import {
  type ToolOperationAdmission,
  type ToolOperationAdmissionDecision,
  type ToolOperationDescriptor,
  type ToolOperationEventType,
  type ToolOperationJournalOptions,
  type ToolOperationJournalStore,
  type ToolOperationLifecycle,
  type ToolOperationObserver,
  type ToolOperationOwner,
  type ToolOperationSetReceipt,
} from "./tool-operation-model.js";
import {
  retryableToolOperationConflict,
  ToolOperationPhaseJournal,
} from "./tool-operation-phase-journal.js";
import { projectToolOperationSet } from "./tool-operation-set-projection.js";

type LifecycleLocalState = LifecycleExecutionAuthority &
  ToolOperationHeartbeatState;

export { ToolOperationFencingError };

export class DurableToolOperationJournal {
  private readonly coordinator: ToolOperationJournalCoordinator;
  private readonly phases: ToolOperationPhaseJournal;
  private readonly execution: ToolOperationExecutionAuthority;
  private readonly leaseIssuer: ToolOperationLeaseIssuer;

  constructor(
    private readonly store: ToolOperationJournalStore,
    private readonly owner: ToolOperationOwner,
    private readonly options: ToolOperationJournalOptions = {},
  ) {
    if (typeof store.appendEventOnceAtRunHead !== "function") {
      throw new Error(
        "DurableToolOperationJournal requires atomic run-head conditional append support",
      );
    }
    this.coordinator = toolOperationCoordinator(store, owner.runId);
    this.phases = new ToolOperationPhaseJournal(
      store,
      owner,
      this.coordinator,
      options.contentionRetry,
    );
    this.leaseIssuer = toolOperationLeaseIssuer(options);
    this.execution = new ToolOperationExecutionAuthority(
      this.phases,
      this.coordinator,
      this.leaseIssuer,
      () => this.nowMs(),
      (admission) => this.isCurrentEpoch(admission),
      options.contentionRetry,
    );
  }
  observer(parentCallId: string): ToolOperationObserver {
    assertToolOperationParentCallId(parentCallId);
    return {
      operation: (descriptor) =>
        this.operation(
          parentCallId,
          normalizeToolOperationDescriptor(descriptor),
        ),
    };
  }
  async operationSet(parentCallId: string): Promise<ToolOperationSetReceipt> {
    assertToolOperationParentCallId(parentCallId);
    return this.serial(async () => {
      const operations = projectToolOperationSet(
        await this.phases.events(),
        parentCallId,
      );
      return {
        kind: "napier.tool-operation-set",
        schemaVersion: 1,
        parentCallId,
        operationCount: operations.length,
        settledOperationCount: operations.filter(
          (operation) => operation.settled !== undefined,
        ).length,
        operationSetSha256: sha256(canonicalJson(operations)),
      };
    });
  }
  private operation(
    parentCallId: string,
    descriptor: ToolOperationDescriptor,
  ): ToolOperationLifecycle {
    const binding = bindToolOperationDescriptor(parentCallId, descriptor);
    const local: LifecycleLocalState = {};
    return {
      operationId: binding.operationId,
      proposed: () => this.appendPhase("tool.operation.proposed", binding, {}),
      admit: (input = { admitted: true }) => this.admit(binding, input, local),
      preflight: () => this.preflight(binding, local),
      heartbeat: () => this.heartbeat(binding, local),
      started: async () => {
        await this.start(binding, local);
        scheduleToolOperationHeartbeat(
          local,
          this.execution.heartbeatIntervalMs,
          () => this.heartbeat(binding, local),
        );
      },
      effectBoundary: async () => {
        try {
          await this.serial(() =>
            this.execution.effectBoundary(binding, local),
          );
        } catch (error) {
          stopToolOperationHeartbeat(local);
          throw error;
        }
      },
      settled: async (input) => {
        try {
          await this.settle(binding, input, local);
        } finally {
          stopToolOperationHeartbeat(local);
        }
      },
      repairSettled: (input) =>
        this.serial(() => this.execution.repairSettled(binding, input)),
    };
  }

  private admit(
    binding: BoundToolOperationDescriptor,
    input: ToolOperationAdmission,
    local: LifecycleLocalState,
  ): Promise<ToolOperationAdmissionDecision> {
    return this.serial(async () => {
      await this.phases.append("tool.operation.proposed", binding, {});
      return retryCasConflict({
        operation: async () => {
          const existing = await this.existingAdmission(binding, local, true);
          if (existing) return existing;
          const guard = await this.admissionGuard(binding);
          const blocker = guard.circuit?.blocks
            ? guard.circuit
            : activeProbeBlocker(guard);
          if (blocker) {
            return await this.rejectForCircuit(binding, {
              circuit: blocker,
              epoch: guard.projection.epoch,
              policySha256: guard.projection.policySha256,
              throughSeq: guard.projection.throughSeq,
              asOfMs: guard.asOfMs,
            });
          }
          return await this.recordCallerAdmission(binding, input, local, guard);
        },
        isConflict: retryableToolOperationConflict,
        exhaustedMessage: `Tool operation ${binding.operationId} admission was contended`,
        ...(this.options.contentionRetry
          ? { options: this.options.contentionRetry }
          : {}),
      });
    });
  }

  private preflight(
    binding: BoundToolOperationDescriptor,
    local: LifecycleLocalState,
  ): Promise<ToolOperationAdmissionDecision> {
    return this.serial(async () => {
      await this.phases.append("tool.operation.proposed", binding, {});
      return retryCasConflict({
        operation: async () => {
          const existing = await this.existingAdmission(binding, local, false);
          if (existing) return existing;
          const guard = await this.admissionGuard(binding);
          const blocker = guard.circuit?.blocks
            ? guard.circuit
            : activeProbeBlocker(guard);
          if (!blocker) return executableAdmissionDecision("caller");
          return await this.rejectForCircuit(binding, {
            circuit: blocker,
            epoch: guard.projection.epoch,
            policySha256: guard.projection.policySha256,
            throughSeq: guard.projection.throughSeq,
            asOfMs: guard.asOfMs,
          });
        },
        isConflict: retryableToolOperationConflict,
        exhaustedMessage: `Tool operation ${binding.operationId} preflight was contended`,
        ...(this.options.contentionRetry
          ? { options: this.options.contentionRetry }
          : {}),
      });
    });
  }

  private async recordCallerAdmission(
    binding: BoundToolOperationDescriptor,
    input: ToolOperationAdmission,
    local: LifecycleLocalState,
    guard: ToolOperationAdmissionGuard,
  ): Promise<ToolOperationAdmissionDecision> {
    const failure = input.admitted
      ? undefined
      : operationFailure(input.diagnostic, input.details, input.failure);
    const lease = input.admitted
      ? initialExecutionLease(this.leaseIssuer, guard.asOfMs)
      : undefined;
    const receipt = await this.phases.append(
      "tool.operation.admitted",
      binding,
      {
        admission: input.admitted ? "admitted" : "rejected",
        admissionSource: "caller",
        ...(input.admitted ? halfOpenProbeFields(guard) : {}),
        ...(lease ? executionLeaseFields(lease) : {}),
        ...(failure ? { failure } : {}),
      },
      guard.projection.throughSeq,
    );
    if (!receipt.appended) {
      const replay = await this.existingAdmission(binding, local, true);
      if (replay) return replay;
      throw new Error(
        `Tool operation ${binding.operationId} admission replay is missing`,
      );
    }
    if (input.admitted && lease) local.executionLease = lease;
    return {
      admitted: input.admitted,
      source: "caller",
      disposition: input.admitted ? "execute" : "rejected",
      ...(lease ? { executionLease: lease } : {}),
      ...(!input.admitted
        ? { reason: String(input.diagnostic ?? "operation was rejected") }
        : {}),
    };
  }

  private start(
    binding: BoundToolOperationDescriptor,
    local: LifecycleLocalState,
  ): Promise<void> {
    return this.serial(() => this.execution.start(binding, local));
  }

  private settle(
    binding: BoundToolOperationDescriptor,
    input: Parameters<ToolOperationLifecycle["settled"]>[0],
    local: LifecycleLocalState,
  ): Promise<void> {
    return this.serial(() => this.execution.settle(binding, input, local));
  }

  private heartbeat(
    binding: BoundToolOperationDescriptor,
    local: LifecycleLocalState,
  ): Promise<void> {
    return this.serial(() => this.execution.heartbeat(binding, local));
  }

  private async admissionGuard(
    binding: BoundToolOperationDescriptor,
  ): Promise<ToolOperationAdmissionGuard> {
    const events = await this.store.listRunEvents(this.owner.runId);
    this.phases.syncRunEvents(events);
    const asOfMs = operationAdmissionTimestamp(
      this.options.now?.() ?? Date.now(),
    );
    return projectToolOperationAdmissionGuard({
      events,
      runId: this.owner.runId,
      binding,
      options: this.options,
      asOfMs,
    });
  }

  private async rejectForCircuit(
    binding: BoundToolOperationDescriptor,
    decision: OpenToolOperationCircuitDecision,
  ): Promise<ToolOperationAdmissionDecision> {
    const { circuit } = decision;
    const reason = `Failure circuit is open for ${circuit.scope}`;
    const failure = operationFailure(reason, {
      circuitKeySha256: circuit.keySha256,
      circuitScope: circuit.scope,
    });
    const receipt = await this.phases.append(
      "tool.operation.admitted",
      binding,
      {
        admission: "rejected",
        admissionSource: "failure_circuit",
        circuitKeySha256: circuit.keySha256,
        circuitScope: circuit.scope,
        circuitStatus: "open",
        circuitEpoch: decision.epoch,
        circuitPolicySha256: decision.policySha256,
        circuitThroughSeq: decision.throughSeq,
        circuitAsOfMs: decision.asOfMs,
        ...(circuit.retryAfterMs !== undefined
          ? { circuitRetryAfterMs: circuit.retryAfterMs }
          : {}),
        failure,
      },
      decision.throughSeq,
    );
    if (!receipt.appended) {
      const replay = await this.existingAdmission(binding, {}, false);
      if (replay) return replay;
    }
    await this.appendCircuitSettlement(binding, circuit.keySha256, failure);
    return circuitRejectionDecision(reason, circuit);
  }

  private async existingAdmission(
    binding: BoundToolOperationDescriptor,
    local: LifecycleLocalState,
    claimExpiredLease: boolean,
  ): Promise<ToolOperationAdmissionDecision | undefined> {
    let state = toolOperationLedgerState(
      await this.phases.events(),
      binding.operationId,
    );
    if (!state.admitted || !state.admission || !state.admissionSource) {
      return undefined;
    }
    let payload = operationObject(state.admitted.payload);
    if (!payload) return undefined;
    if (state.admissionSource === "failure_circuit" && !state.settled) {
      await this.repairCircuitSettlement(binding, payload);
      state = toolOperationLedgerState(
        await this.phases.events(),
        binding.operationId,
      );
      if (!state.admitted || !state.admission || !state.admissionSource) {
        return undefined;
      }
      payload = operationObject(state.admitted?.payload);
      if (!payload) return undefined;
    }
    if (state.effectIndeterminate) return indeterminateReplayDecision();
    if (state.settled) return terminalReplayDecision(state.settled);
    if (!(await this.isCurrentEpoch(state.admitted))) {
      return staleEpochReplayDecision();
    }
    if (state.admission === "rejected") {
      return replayedAdmissionDecision(
        state.admission,
        state.admissionSource,
        payload,
      );
    }
    const lease = state.executionLease;
    if (!lease) {
      if (state.startedEvents.length > 0) return indeterminateReplayDecision();
      return claimExpiredLease
        ? this.execution.claim(binding, state, local)
        : executableAdmissionDecision(state.admissionSource);
    }
    if (!executionLeaseExpired(lease, this.nowMs())) {
      if (sameExecutionLease(local.executionLease, lease) && !state.started) {
        return executableAdmissionDecision(state.admissionSource, lease);
      }
      return inFlightReplayDecision(lease);
    }
    // Once caller code may have produced an external effect, expiry is not
    // evidence that the prior executor stopped. Only its matching settlement
    // can release this generation; otherwise recovery remains indeterminate.
    if (
      state.effectBoundary ||
      (state.started && !allowsStartedExecutionTakeover(binding))
    ) {
      return indeterminateReplayDecision();
    }
    return claimExpiredLease
      ? this.execution.claim(binding, state, local)
      : executableAdmissionDecision(state.admissionSource);
  }

  private nowMs(): number {
    return operationAdmissionTimestamp(this.options.now?.() ?? Date.now());
  }
  private async isCurrentEpoch(admission: RunEvent): Promise<boolean> {
    const projection = await this.failureCircuitProjection();
    return admission.seq >= projection.epochStartedAtSeq;
  }

  private async failureCircuitProjection(): Promise<RunFailureCircuitProjection> {
    return projectRunFailureCircuits(
      await this.store.listRunEvents(this.owner.runId),
      this.owner.runId,
      this.options.failureCircuit,
    );
  }

  private async repairCircuitSettlement(
    binding: BoundToolOperationDescriptor,
    payload: Record<string, JsonValue>,
  ): Promise<void> {
    const circuitKeySha256 = operationHash(payload["circuitKeySha256"]);
    const failure = operationFailureFromPayload(payload["failure"]);
    if (circuitKeySha256 && failure) {
      await this.appendCircuitSettlement(binding, circuitKeySha256, failure);
    }
  }

  private appendCircuitSettlement(
    binding: BoundToolOperationDescriptor,
    circuitKeySha256: string,
    failure: JsonValue,
  ): Promise<void> {
    return this.phases
      .append("tool.operation.settled", binding, {
        outcome: "skipped",
        effectSha256: circuitRejectionEffectSha256(circuitKeySha256),
        failure,
      })
      .then(() => undefined);
  }

  private appendPhase(
    type: ToolOperationEventType,
    binding: BoundToolOperationDescriptor,
    fields: Record<string, JsonValue>,
  ): Promise<void> {
    return this.serial(() =>
      this.phases.append(type, binding, fields).then(() => undefined),
    );
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.coordinator.queue.then(operation, operation);
    this.coordinator.queue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
}
