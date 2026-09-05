import type { JsonObject, JsonValue, RunEvent } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { IdempotentEventConflictError } from "./event-idempotency.js";
import type { AppendEventInput } from "./run-event-registry.js";
import { durableTerminalRunStatus } from "./run-event-admission.js";
import { ConcurrentRunEventHeadError } from "./sqlite-ledger-errors.js";
import {
  retryCasConflict,
  type CasConflictRetryOptions,
} from "./cas-conflict-retry.js";
import type { BoundToolOperationDescriptor } from "./tool-operation-binding.js";
import {
  assertToolOperationPhaseState,
  assertToolOperationTransition,
  findToolOperationPhase,
  toolOperationEventPayload,
  toolOperationLedgerState,
  type ToolOperationJournalCoordinator,
} from "./tool-operation-ledger-support.js";
import {
  TOOL_OPERATION_EVENT_TYPES,
  type ToolOperationEventType,
  type ToolOperationJournalStore,
  type ToolOperationOwner,
} from "./tool-operation-model.js";

export interface AppendedOperationPhase {
  event: RunEvent;
  appended: boolean;
}

export class ToolOperationPhaseJournal {
  constructor(
    private readonly store: ToolOperationJournalStore,
    private readonly owner: ToolOperationOwner,
    private readonly coordinator: ToolOperationJournalCoordinator,
    private readonly contentionRetry?: Readonly<CasConflictRetryOptions>,
  ) {}

  async append(
    type: ToolOperationEventType,
    binding: BoundToolOperationDescriptor,
    fields: Record<string, JsonValue>,
    expectedRunHeadSeq?: number,
  ): Promise<AppendedOperationPhase> {
    const phase = type.slice("tool.operation.".length);
    const phaseStateSha256 = sha256(
      canonicalJson({
        descriptorSha256: binding.descriptorSha256,
        phase,
        ...fields,
      }),
    );
    const payload = toolOperationEventPayload(
      binding,
      phaseStateSha256,
      fields,
    );
    const appendOnce = async (): Promise<AppendedOperationPhase> => {
      const events = await this.events();
      const existing = findToolOperationPhase(
        events,
        type,
        binding.operationId,
        fields,
      );
      if (existing) {
        if (!contendedExecutionAuthorityPhase(type)) {
          assertToolOperationPhaseState(
            existing,
            phaseStateSha256,
            binding.operationId,
          );
        }
        return { event: existing, appended: false };
      }
      assertToolOperationTransition(
        type,
        toolOperationLedgerState(events, binding.operationId),
        fields,
        binding.operationId,
      );
      const receipt = await this.appendEvent(
        type,
        payload,
        binding.operationId,
        expectedRunHeadSeq ?? this.coordinator.throughSeq,
      );
      if (receipt.appended || !contendedExecutionAuthorityPhase(type)) {
        assertToolOperationPhaseState(
          receipt.event,
          phaseStateSha256,
          binding.operationId,
        );
      }
      this.mergeEvent(receipt.event);
      return receipt;
    };

    // An explicit head belongs to an outer read/derive/CAS transaction, which
    // must re-project its decision after a conflict. Headless phase appends can
    // safely retry this whole transition locally because appendOnce reloads
    // and validates the complete operation state on every attempt.
    if (expectedRunHeadSeq !== undefined) return appendOnce();
    return retryCasConflict({
      operation: appendOnce,
      isConflict: retryableToolOperationConflict,
      exhaustedMessage: `Tool operation ${binding.operationId} ${phase} was contended`,
      ...(this.contentionRetry ? { options: this.contentionRetry } : {}),
    });
  }

  async events(): Promise<RunEvent[]> {
    const fresh = await this.store.listRunEvents(
      this.owner.runId,
      this.coordinator.throughSeq,
    );
    this.syncRunEvents(fresh);
    return this.coordinator.events;
  }

  async runIsTerminal(): Promise<boolean> {
    const events = await this.store.listRunEvents(this.owner.runId);
    this.syncRunEvents(events);
    return Boolean(
      durableTerminalRunStatus(events, this.owner.threadId, this.owner.runId),
    );
  }

  syncRunEvents(events: readonly RunEvent[]): void {
    for (const event of events) {
      this.coordinator.throughSeq = Math.max(
        this.coordinator.throughSeq,
        event.seq,
      );
      if (
        (TOOL_OPERATION_EVENT_TYPES as readonly string[]).includes(event.type)
      ) {
        this.mergeEvent(event);
      }
    }
  }

  private appendEvent(
    type: ToolOperationEventType,
    payload: JsonObject,
    operationId: string,
    expectedRunHeadSeq: number,
  ): Promise<AppendedOperationPhase> {
    const input = {
      threadId: this.owner.threadId,
      runId: this.owner.runId,
      type,
      category: "tool",
      visibility: "debug",
      payload,
    } as AppendEventInput;
    return this.store.appendEventOnceAtRunHead(input, {
      namespace: "tool-operation-phase",
      key: phaseIdempotencyKey(type, operationId, payload),
      expectedRunHeadSeq,
    });
  }

  private mergeEvent(event: RunEvent): void {
    if (
      !this.coordinator.events.some((candidate) => candidate.id === event.id)
    ) {
      this.coordinator.events.push(event);
      this.coordinator.events.sort((left, right) => left.seq - right.seq);
    }
    this.coordinator.throughSeq = Math.max(
      this.coordinator.throughSeq,
      event.seq,
    );
  }
}

function contendedExecutionAuthorityPhase(
  type: ToolOperationEventType,
): boolean {
  return (
    type === "tool.operation.admitted" ||
    type === "tool.operation.lease.granted" ||
    type === "tool.operation.lease.renewed"
  );
}

function phaseIdempotencyKey(
  type: ToolOperationEventType,
  operationId: string,
  payload: JsonObject,
): string {
  const phase = type.slice("tool.operation.".length);
  const generation = payload["executionLeaseGeneration"];
  if (!Number.isSafeInteger(generation)) return `${operationId}:${phase}`;
  if (type === "tool.operation.lease.renewed") {
    return `${operationId}:${phase}:${String(generation)}:${String(
      payload["executionLeaseExpiresAtMs"],
    )}`;
  }
  return type === "tool.operation.lease.granted" ||
    type === "tool.operation.started"
    ? `${operationId}:${phase}:${String(generation)}`
    : `${operationId}:${phase}`;
}

export function retryableToolOperationConflict(error: unknown): boolean {
  // Tool admission and lease keys double as winner slots. A concurrent winner
  // can therefore surface as an idempotency conflict after this process read
  // the old head. Callers always re-project the durable lifecycle before the
  // next CAS; ordinary phases still assert the winner's exact phase hash, so a
  // true semantic mismatch is never converted into a successful replay.
  return (
    error instanceof ConcurrentRunEventHeadError ||
    error instanceof IdempotentEventConflictError
  );
}
