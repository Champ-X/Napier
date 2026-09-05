import type { RunEvent, ToolOperationFailureV1 } from "@napier/contracts";
import type {
  ToolFailureBindingScope,
  ToolFailureBindingsV1,
  ToolFailureReceiptV1,
  ToolProgressContribution,
  ToolProgressOperation,
  ToolProgressScope,
} from "@napier/contracts/tool-protocol";

import type {
  ResolvedRunFailureCircuit,
  RunFailureCircuitProjectionOptions,
} from "./run-failure-circuit-model.js";
import type { CasConflictRetryOptions } from "./cas-conflict-retry.js";
import type { AppendEventInput } from "./run-event-registry.js";

export const TOOL_OPERATION_EVENT_TYPES = [
  "tool.operation.proposed",
  "tool.operation.admitted",
  "tool.operation.effect_indeterminate",
  "tool.operation.lease.granted",
  "tool.operation.lease.renewed",
  "tool.operation.started",
  "tool.operation.settled",
] as const;

export type ToolOperationEventType =
  (typeof TOOL_OPERATION_EVENT_TYPES)[number];

export interface ToolOperationJournalStore {
  appendEvent(input: AppendEventInput): Promise<RunEvent>;
  appendEventOnceAtRunHead(
    input: AppendEventInput,
    options: {
      namespace: string;
      key: string;
      expectedRunHeadSeq: number;
    },
  ): Promise<{ event: RunEvent; appended: boolean }>;
  listRunEvents(
    runId: string,
    afterSeq?: number,
    types?: readonly string[],
  ): Promise<RunEvent[]>;
}

export interface ToolOperationOwner {
  threadId: string;
  runId: string;
}

/**
 * Caller-private descriptor. Only canonical hashes of resource and failure
 * bindings cross the durable ledger boundary.
 */
export interface ToolOperationDescriptor {
  /**
   * Execution fencing is orthogonal to domain progress. Authority envelopes
   * are durable operations, but must never become progress observations or
   * suppress the parent tool's own declared progress.
   */
  role?: "progress" | "execution_authority";
  /** Defaults to never; progress semantics must not imply replay safety. */
  startedTakeover?: "never" | "idempotent";
  ordinal: number;
  mode: string;
  route: string;
  operation: ToolProgressOperation;
  scope: ToolProgressScope;
  contribution: ToolProgressContribution;
  resourceKey: unknown;
  /** Scope-specific circuit identities; raw values stay caller-private. */
  failureBindings?: Partial<Record<ToolFailureBindingScope, unknown>>;
  /** Expected hash for declared failure receipts emitted by this operation. */
  failureDefinitionSha256?: string;
  /** Legacy catch-all identity retained for durable ABI compatibility. */
  failureDomainKey: unknown;
}

export interface ToolOperationAdmission {
  admitted: boolean;
  /** Preferred structured evidence; diagnostic/details are legacy fallback. */
  failure?: ToolFailureReceiptV1;
  diagnostic?: unknown;
  details?: unknown;
}

export interface ToolOperationAdmissionDecision {
  /** True only when this lifecycle instance owns permission to execute. */
  admitted: boolean;
  source: "caller" | "failure_circuit" | "replay";
  disposition:
    | "execute"
    | "rejected"
    | "terminal_replay"
    | "in_flight_replay"
    | "indeterminate_replay"
    | "stale_epoch_replay";
  reason?: string;
  terminal?: {
    outcome: ToolOperationSettlement["outcome"];
    effectSha256: string;
    stateSha256?: string;
  };
  circuit?: Pick<
    ResolvedRunFailureCircuit,
    "keySha256" | "scope" | "status" | "retryAfterMs"
  >;
  executionLease?: ToolOperationExecutionLease;
}

export interface ToolOperationJournalOptions {
  failureCircuit?: RunFailureCircuitProjectionOptions;
  now?: () => number | string;
  /** Bounded optimistic-write retry policy; wait/random are test seams. */
  contentionRetry?: CasConflictRetryOptions;
  executionLease?: {
    /** Private worker/process identity. Only its SHA-256 enters the ledger. */
    ownerId?: string;
    durationMs?: number;
  };
}

export type ToolOperationExecutionLeaseDisposition =
  | "initial"
  | "renewal"
  | "unstarted_takeover"
  | "safe_started_takeover";

export interface ToolOperationExecutionLease {
  ownerSha256: string;
  generation: number;
  acquiredAtMs: number;
  expiresAtMs: number;
  disposition: ToolOperationExecutionLeaseDisposition;
  previousGeneration?: number;
}

export interface ToolOperationSettlement {
  outcome: "succeeded" | "failed" | "skipped";
  /** Preferred structured evidence; diagnostic/details are legacy fallback. */
  failure?: ToolFailureReceiptV1;
  diagnostic?: unknown;
  details?: unknown;
  /** Stable resulting state, never a timestamp or transient counter. */
  state?: unknown;
  /** Stable externally observable effect. */
  effect?: unknown;
}

export interface ToolOperationSettlementRepair {
  settlement: ToolOperationSettlement;
  /** Hash of a validated, immutable result receipt for this exact call. */
  resultEvidenceSha256: string;
  /** Run sequence proving the result followed the current started generation. */
  resultEvidenceEventSeq: number;
}

export interface ToolOperationSettlementRepairDecision {
  disposition:
    | "repaired"
    | "terminal_replay"
    | "in_flight_replay"
    | "not_repairable";
}

export interface ToolOperationLifecycle {
  readonly operationId: string;
  proposed(): Promise<void>;
  /** Atomically checks the replayed circuit before durable admission. */
  admit(
    input?: ToolOperationAdmission,
  ): Promise<ToolOperationAdmissionDecision>;
  /** Avoids local preparation work when this exact binding is already open. */
  preflight(): Promise<ToolOperationAdmissionDecision>;
  /** Extends the current generation; implementations may also heartbeat it. */
  heartbeat?(): Promise<void>;
  started(): Promise<void>;
  /** Revalidates durable Run and lease authority immediately before effects. */
  effectBoundary(): Promise<void>;
  settled(input: ToolOperationSettlement): Promise<void>;
  /** Finalizes an expired started generation from durable result evidence. */
  repairSettled(
    input: ToolOperationSettlementRepair,
  ): Promise<ToolOperationSettlementRepairDecision>;
}

export interface ToolOperationObserver {
  operation(descriptor: ToolOperationDescriptor): ToolOperationLifecycle;
}

export interface ToolOperationSetReceipt {
  kind: "napier.tool-operation-set";
  schemaVersion: 1;
  parentCallId: string;
  operationCount: number;
  settledOperationCount: number;
  operationSetSha256: string;
}

export interface SettledToolOperationProgressObservation {
  kind: "napier.settled-tool-operation-progress";
  schemaVersion: 1;
  observationId: string;
  parentCallId: string;
  operationId: string;
  settledEventSeq: number;
  ordinal: number;
  mode: string;
  route: string;
  admission: "admitted" | "rejected";
  admissionSource: "caller" | "failure_circuit";
  outcome: "succeeded" | "failed" | "skipped";
  progress: {
    availability: "declared";
    coverage: "trusted_declared";
    operation: ToolProgressOperation;
    scope: ToolProgressScope;
    contribution: ToolProgressContribution;
    resourceKeySha256: string;
    failureBindings?: ToolFailureBindingsV1;
    failureDomainKeySha256: string;
    stateSha256?: string;
  };
  acquisitionAttempt: boolean;
  acquisitionAdvance: boolean;
  failureObserved: boolean;
  acquisitionFailure: boolean;
  failure?: ToolOperationFailureV1;
  effectSha256: string;
}

export interface ToolOperationProgressProjection {
  kind: "napier.tool-operation-progress-projection";
  schemaVersion: 1;
  /** Parent calls here must not also be counted as singleton attempts. */
  suppressParentSingletonCallIds: string[];
  observations: SettledToolOperationProgressObservation[];
  observationSetSha256: string;
}
