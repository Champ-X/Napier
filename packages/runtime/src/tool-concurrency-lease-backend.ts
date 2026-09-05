import type { ToolConcurrency } from "@napier/contracts/tool-protocol";

export interface DurableToolConcurrencyRequirement {
  readonly key: readonly string[];
  readonly mode: ToolConcurrency;
}

export interface DurableToolConcurrencyLeaseToken {
  readonly leaseId: string;
  readonly ownerId: string;
  readonly operationId: string;
  readonly generation: number;
}

export interface DurableToolConcurrencyLease extends DurableToolConcurrencyLeaseToken {
  readonly requirements: readonly DurableToolConcurrencyRequirement[];
  readonly acquiredAtMs: number;
  readonly heartbeatAtMs: number;
  readonly expiresAtMs: number;
}

export type DurableToolConcurrencyClaimResult =
  | {
      readonly status: "acquired";
      readonly lease: DurableToolConcurrencyLease;
    }
  | {
      readonly status: "blocked";
      readonly retryAtMs: number;
    };

export interface ClaimDurableToolConcurrencyLeaseInput {
  readonly leaseId: string;
  readonly ownerId: string;
  readonly operationId: string;
  readonly requirements: readonly DurableToolConcurrencyRequirement[];
  readonly ancestorLeases: readonly DurableToolConcurrencyLeaseToken[];
  readonly nowMs: number;
  readonly expiresAtMs: number;
}

export interface RenewDurableToolConcurrencyLeaseInput {
  readonly lease: DurableToolConcurrencyLeaseToken;
  readonly nowMs: number;
  readonly expiresAtMs: number;
}

export interface InspectDurableToolConcurrencyLeaseInput {
  readonly lease: DurableToolConcurrencyLeaseToken;
  readonly nowMs: number;
}

export interface ToolConcurrencyLeaseBackend {
  claim(
    input: ClaimDurableToolConcurrencyLeaseInput,
  ):
    | DurableToolConcurrencyClaimResult
    | Promise<DurableToolConcurrencyClaimResult>;
  renew(
    input: RenewDurableToolConcurrencyLeaseInput,
  ): DurableToolConcurrencyLease | Promise<DurableToolConcurrencyLease>;
  assertCurrent(
    input: InspectDurableToolConcurrencyLeaseInput,
  ): DurableToolConcurrencyLease | Promise<DurableToolConcurrencyLease>;
  release(input: InspectDurableToolConcurrencyLeaseInput): void | Promise<void>;
}

export class ToolConcurrencyDurableLeaseFencedError extends Error {
  readonly code = "TOOL_CONCURRENCY_DURABLE_LEASE_FENCED";

  constructor(
    readonly leaseId: string,
    readonly ownerId: string,
    readonly generation: number,
  ) {
    super(
      `Tool concurrency lease ${leaseId} generation ${generation} is no longer current`,
    );
    this.name = "ToolConcurrencyDurableLeaseFencedError";
  }
}
