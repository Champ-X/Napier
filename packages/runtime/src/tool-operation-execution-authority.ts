import type { JsonValue, RunEvent } from "@napier/contracts";

import {
  retryCasConflict,
  type CasConflictRetryOptions,
} from "./cas-conflict-retry.js";
import {
  operationHash,
  operationNonNegativeInteger,
  operationObject,
  type BoundToolOperationDescriptor,
} from "./tool-operation-binding.js";
import {
  executionLeaseExpired,
  executionLeaseFields,
  executionLeaseFromPayload,
  executionLeaseTokenFields,
  executionLeaseTokenFromPayload,
  renewedExecutionLease,
  sameExecutionLease,
  takeoverExecutionLease,
  type ToolOperationLeaseIssuer,
} from "./tool-operation-execution-lease.js";
import {
  executableAdmissionDecision,
  indeterminateReplayDecision,
  inFlightReplayDecision,
  toolOperationLedgerState,
  toolOperationSettlementFields,
  type ToolOperationJournalCoordinator,
  type ToolOperationLedgerState,
} from "./tool-operation-ledger-support.js";
import type {
  ToolOperationAdmissionDecision,
  ToolOperationExecutionLease,
  ToolOperationSettlement,
  ToolOperationSettlementRepair,
  ToolOperationSettlementRepairDecision,
} from "./tool-operation-model.js";
import {
  retryableToolOperationConflict,
  ToolOperationPhaseJournal,
} from "./tool-operation-phase-journal.js";
import { RunEventAdmissionError } from "./run-event-admission.js";

export interface LifecycleExecutionAuthority {
  executionLease?: ToolOperationExecutionLease;
}

export class ToolOperationFencingError extends Error {
  override readonly name = "ToolOperationFencingError";

  constructor(
    readonly operationId: string,
    reason: string,
  ) {
    super(
      `Tool operation ${operationId} execution lease was fenced: ${reason}`,
    );
  }
}

export class ToolOperationExecutionAuthority {
  constructor(
    private readonly phases: ToolOperationPhaseJournal,
    private readonly coordinator: ToolOperationJournalCoordinator,
    private readonly issuer: ToolOperationLeaseIssuer,
    private readonly nowMs: () => number,
    private readonly isCurrentEpoch: (admission: RunEvent) => Promise<boolean>,
    private readonly contentionRetry?: Readonly<CasConflictRetryOptions>,
  ) {}

  get heartbeatIntervalMs(): number {
    return Math.max(1, Math.floor(this.issuer.durationMs / 3));
  }

  async claim(
    binding: BoundToolOperationDescriptor,
    state: ToolOperationLedgerState,
    local: LifecycleExecutionAuthority,
  ): Promise<ToolOperationAdmissionDecision> {
    if (state.effectBoundary) return indeterminateReplayDecision();
    const previousGeneration = state.executionLease?.generation ?? 0;
    const lease = takeoverExecutionLease(
      this.issuer,
      previousGeneration,
      this.nowMs(),
      state.started ? "safe_started_takeover" : "unstarted_takeover",
    );
    const receipt = await this.phases.append(
      "tool.operation.lease.granted",
      binding,
      executionLeaseFields(lease),
      this.coordinator.throughSeq,
    );
    if (!receipt.appended) {
      return inFlightReplayDecision(
        executionLeaseFromPayload(receipt.event.payload),
      );
    }
    local.executionLease = lease;
    return executableAdmissionDecision(
      state.admissionSource ?? "caller",
      lease,
    );
  }

  async start(
    binding: BoundToolOperationDescriptor,
    local: LifecycleExecutionAuthority,
  ): Promise<void> {
    return retryCasConflict({
      operation: async () => {
        const state = toolOperationLedgerState(
          await this.phases.events(),
          binding.operationId,
        );
        if (!state.admitted || !(await this.isCurrentEpoch(state.admitted))) {
          throw new Error(
            `Tool operation ${binding.operationId} cannot start without a current local execution grant`,
          );
        }
        const lease = this.assertCurrentLocalLease(binding, state, local);
        if (executionLeaseExpired(lease, this.nowMs())) {
          throw new ToolOperationFencingError(
            binding.operationId,
            "the execution lease expired before start",
          );
        }
        await this.phases.append(
          "tool.operation.started",
          binding,
          executionLeaseTokenFields(lease),
          this.coordinator.throughSeq,
        );
      },
      isConflict: retryableToolOperationConflict,
      exhaustedMessage: `Tool operation ${binding.operationId} start was contended`,
      ...(this.contentionRetry ? { options: this.contentionRetry } : {}),
    });
  }

  async heartbeat(
    binding: BoundToolOperationDescriptor,
    local: LifecycleExecutionAuthority,
  ): Promise<void> {
    return this.renew(binding, local, false);
  }

  async effectBoundary(
    binding: BoundToolOperationDescriptor,
    local: LifecycleExecutionAuthority,
  ): Promise<void> {
    return this.renew(binding, local, true);
  }

  private async renew(
    binding: BoundToolOperationDescriptor,
    local: LifecycleExecutionAuthority,
    forceActiveFence: boolean,
  ): Promise<void> {
    return retryCasConflict({
      operation: async () => {
        if (await this.phases.runIsTerminal()) {
          throw new ToolOperationFencingError(
            binding.operationId,
            "the Run became terminal before lease renewal",
          );
        }
        const state = toolOperationLedgerState(
          await this.phases.events(),
          binding.operationId,
        );
        if (state.settled) {
          throw new ToolOperationFencingError(
            binding.operationId,
            "the operation already settled before lease renewal",
          );
        }
        const lease = this.assertCurrentLocalLease(binding, state, local);
        const now = this.nowMs();
        if (executionLeaseExpired(lease, now)) {
          throw new ToolOperationFencingError(
            binding.operationId,
            "the execution lease expired before renewal",
          );
        }
        // The effect boundary always forces a write so the SQLite admission
        // transaction serializes it against a concurrent terminal transition.
        // Background heartbeats retain normal clock-based renewal behavior.
        const acquiredAtMs = forceActiveFence
          ? Math.max(now, lease.expiresAtMs - this.issuer.durationMs + 1)
          : now;
        const renewed = renewedExecutionLease(this.issuer, lease, acquiredAtMs);
        if (renewed.expiresAtMs <= lease.expiresAtMs) return;
        try {
          await this.phases.append(
            "tool.operation.lease.renewed",
            binding,
            {
              ...executionLeaseFields(renewed),
              ...(forceActiveFence ? { executionEffectBoundary: true } : {}),
            },
            this.coordinator.throughSeq,
          );
          local.executionLease = renewed;
        } catch (error) {
          if (error instanceof RunEventAdmissionError) {
            throw new ToolOperationFencingError(
              binding.operationId,
              "the Run became terminal before lease renewal",
            );
          }
          throw error;
        }
      },
      isConflict: retryableToolOperationConflict,
      exhaustedMessage: `Tool operation ${binding.operationId} lease renewal was contended`,
      ...(this.contentionRetry ? { options: this.contentionRetry } : {}),
    });
  }

  async settle(
    binding: BoundToolOperationDescriptor,
    input: ToolOperationSettlement,
    local: LifecycleExecutionAuthority,
  ): Promise<void> {
    return retryCasConflict({
      operation: async () => {
        const state = toolOperationLedgerState(
          await this.phases.events(),
          binding.operationId,
        );
        if (!state.admitted || !state.admission) {
          throw new Error(
            `Tool operation ${binding.operationId} cannot settle without durable admission`,
          );
        }
        if (state.effectIndeterminate) {
          throw new ToolOperationFencingError(
            binding.operationId,
            "authority was abandoned as effect-indeterminate during recovery",
          );
        }
        // A control epoch may advance while admitted work is already running.
        // Settlement is durable audit of that effect and is fenced by the
        // execution-lease generation below; epoch freshness is required before
        // start, never after an effect may already have happened.
        const lease =
          state.admission === "admitted"
            ? this.assertCurrentLocalLease(binding, state, local)
            : undefined;
        if (
          lease &&
          executionLeaseExpired(lease, this.nowMs()) &&
          !state.effectBoundary
        ) {
          throw new ToolOperationFencingError(
            binding.operationId,
            "the execution lease expired before settlement",
          );
        }
        const fields = settlementFields(input, lease);
        if (state.settled) {
          this.assertTerminalLease(binding, state.settled, lease);
          await this.phases.append("tool.operation.settled", binding, fields);
          return;
        }
        await this.phases.append(
          "tool.operation.settled",
          binding,
          fields,
          this.coordinator.throughSeq,
        );
      },
      isConflict: retryableToolOperationConflict,
      exhaustedMessage: `Tool operation ${binding.operationId} settlement was contended`,
      ...(this.contentionRetry ? { options: this.contentionRetry } : {}),
    });
  }

  async repairSettled(
    binding: BoundToolOperationDescriptor,
    input: ToolOperationSettlementRepair,
  ): Promise<ToolOperationSettlementRepairDecision> {
    if (!operationHash(input.resultEvidenceSha256)) {
      throw new Error("Tool operation result recovery evidence is invalid");
    }
    return retryCasConflict({
      operation: async () => {
        const state = toolOperationLedgerState(
          await this.phases.events(),
          binding.operationId,
        );
        if (
          !resultEvidenceFollowsCurrentStart(
            state,
            input.resultEvidenceEventSeq,
          )
        ) {
          return { disposition: "not_repairable" } as const;
        }
        if (state.effectIndeterminate) {
          return { disposition: "not_repairable" } as const;
        }
        if (state.settled) {
          return terminalMatchesSettlement(state.settled, input.settlement)
            ? ({ disposition: "terminal_replay" } as const)
            : ({ disposition: "not_repairable" } as const);
        }
        if (
          state.admission !== "admitted" ||
          !state.executionLease ||
          !state.started
        ) {
          return { disposition: "not_repairable" } as const;
        }
        if (!executionLeaseExpired(state.executionLease, this.nowMs())) {
          return { disposition: "in_flight_replay" } as const;
        }
        const fields = settlementFields(
          input.settlement,
          state.executionLease,
          input.resultEvidenceSha256,
          input.resultEvidenceEventSeq,
        );
        const receipt = await this.phases.append(
          "tool.operation.settled",
          binding,
          fields,
          this.coordinator.throughSeq,
        );
        return {
          disposition: receipt.appended ? "repaired" : "terminal_replay",
        } as const;
      },
      isConflict: retryableToolOperationConflict,
      exhaustedMessage: `Tool operation ${binding.operationId} result recovery was contended`,
      ...(this.contentionRetry ? { options: this.contentionRetry } : {}),
    });
  }

  private assertCurrentLocalLease(
    binding: BoundToolOperationDescriptor,
    state: ToolOperationLedgerState,
    local: LifecycleExecutionAuthority,
  ): ToolOperationExecutionLease {
    this.assertCurrentCircuitProbe(binding, state);
    const localLease = local.executionLease;
    if (!localLease) {
      throw new Error(
        `Tool operation ${binding.operationId} cannot execute without a current local execution grant`,
      );
    }
    const durableLease = state.executionLease;
    if (!durableLease || !sameExecutionLease(localLease, durableLease)) {
      throw new ToolOperationFencingError(
        binding.operationId,
        `generation ${String(localLease.generation)} is no longer current`,
      );
    }
    return durableLease;
  }

  private assertCurrentCircuitProbe(
    binding: BoundToolOperationDescriptor,
    state: ToolOperationLedgerState,
  ): void {
    const admission = state.admitted;
    const payload = operationObject(admission?.payload);
    const key = operationHash(payload?.["circuitProbeKeySha256"]);
    const epoch = operationNonNegativeInteger(payload?.["circuitProbeEpoch"]);
    const recoveryEpoch = operationNonNegativeInteger(
      payload?.["circuitProbeRecoveryEpoch"],
    );
    if (
      !admission ||
      !key ||
      epoch === undefined ||
      recoveryEpoch === undefined
    ) {
      return;
    }
    const superseded = this.coordinator.events.some((event) => {
      if (
        event.type !== "tool.operation.admitted" ||
        event.seq <= admission.seq
      ) {
        return false;
      }
      const candidate = operationObject(event.payload);
      return (
        candidate?.["admission"] === "admitted" &&
        operationHash(candidate["circuitProbeKeySha256"]) === key &&
        operationNonNegativeInteger(candidate["circuitProbeEpoch"]) === epoch &&
        operationNonNegativeInteger(candidate["circuitProbeRecoveryEpoch"]) ===
          recoveryEpoch
      );
    });
    if (superseded) {
      throw new ToolOperationFencingError(
        binding.operationId,
        "half-open probe authority was superseded",
      );
    }
  }

  private assertTerminalLease(
    binding: BoundToolOperationDescriptor,
    event: RunEvent,
    lease: ToolOperationExecutionLease | undefined,
  ): void {
    const terminal = executionLeaseTokenFromPayload(event.payload);
    if (
      (lease &&
        terminal?.generation === lease.generation &&
        terminal.ownerSha256 === lease.ownerSha256) ||
      (!lease && !terminal)
    ) {
      return;
    }
    throw new ToolOperationFencingError(
      binding.operationId,
      "the terminal event belongs to another execution generation",
    );
  }
}

function settlementFields(
  input: ToolOperationSettlement,
  lease: ToolOperationExecutionLease | undefined,
  resultEvidenceSha256?: string,
  resultEvidenceEventSeq?: number,
): Record<string, JsonValue> {
  return {
    ...toolOperationSettlementFields(input),
    ...(resultEvidenceSha256 ? { resultEvidenceSha256 } : {}),
    ...(resultEvidenceEventSeq !== undefined ? { resultEvidenceEventSeq } : {}),
    ...(lease ? executionLeaseTokenFields(lease) : {}),
  };
}

function resultEvidenceFollowsCurrentStart(
  state: ToolOperationLedgerState,
  eventSeq: number,
): boolean {
  if (!Number.isSafeInteger(eventSeq) || eventSeq < 1 || !state.started) {
    return false;
  }
  if (!state.executionLease) {
    return state.startedEvents.length === 1 && eventSeq > state.started.seq;
  }
  const current = state.executionLease;
  const starts = state.startedEvents.filter((event) => {
    const token = executionLeaseTokenFromPayload(event.payload);
    return (
      token?.generation === current.generation &&
      token.ownerSha256 === current.ownerSha256
    );
  });
  return starts.length === 1 && eventSeq > starts[0]!.seq;
}

function terminalMatchesSettlement(
  event: RunEvent,
  input: ToolOperationSettlement,
): boolean {
  const payload = operationObject(event.payload);
  const expected = toolOperationSettlementFields(input);
  return (
    payload?.["outcome"] === expected["outcome"] &&
    payload?.["effectSha256"] === expected["effectSha256"] &&
    payload?.["stateSha256"] === expected["stateSha256"]
  );
}
