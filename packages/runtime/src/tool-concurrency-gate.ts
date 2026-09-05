import { AsyncLocalStorage } from "node:async_hooks";
import type { ToolConcurrency } from "@napier/contracts/tool-protocol";
import {
  ToolConcurrencyDurableCoordinator,
  type ToolConcurrencyDurableCoordinatorOptions,
} from "./tool-concurrency-durable-coordinator.js";
import type {
  DurableToolConcurrencyLease,
  DurableToolConcurrencyLeaseToken,
} from "./tool-concurrency-lease-backend.js";
import {
  conflictingToolConcurrencyRequirementPairs,
  normalizeToolConcurrencyOperationId,
  normalizeToolConcurrencyRequirements,
  toolConcurrencyModeStrength,
  toolConcurrencyRequirementCovers,
  toolConcurrencyResourcesOverlap,
  type NormalizedToolConcurrencyRequirement as NormalizedRequirement,
  type ToolConcurrencyOperation,
  type ToolConcurrencyResourceRequirement,
} from "./tool-concurrency-model.js";

export type {
  ToolConcurrencyOperation,
  ToolConcurrencyResourceKey,
  ToolConcurrencyResourceRequirement,
} from "./tool-concurrency-model.js";
export {
  ToolConcurrencyDurableLeaseFencedError,
  type DurableToolConcurrencyLease,
  type DurableToolConcurrencyLeaseToken,
  type ToolConcurrencyLeaseBackend,
} from "./tool-concurrency-lease-backend.js";

export interface ToolConcurrencyGateOptions {
  readonly durable?: ToolConcurrencyDurableCoordinatorOptions;
}

interface Lease {
  readonly leaseId: number;
  readonly ownerOperationId: string;
  readonly requirements: readonly NormalizedRequirement[];
  readonly parent?: LeaseContext;
  readonly signal?: AbortSignal;
  active: boolean;
  generation: number;
  abortListener?: () => void;
  durable?: DurableToolConcurrencyLease;
}
interface LeaseContext {
  readonly lease: Lease;
  readonly generation: number;
}
interface PendingAdmission {
  readonly operationId: string;
  readonly requirements: readonly NormalizedRequirement[];
  readonly parent?: LeaseContext;
  readonly signal?: AbortSignal;
  readonly resolve: (lease: Lease) => void;
  readonly reject: (reason: unknown) => void;
  abortListener?: () => void;
  settled: boolean;
}
export class ToolConcurrencyEscalationError extends Error {
  readonly code = "TOOL_CONCURRENCY_ESCALATION";
  constructor(
    readonly operationId: string,
    readonly heldResource: string,
    readonly heldMode: ToolConcurrency,
    readonly requestedResource: string,
    readonly requestedMode: ToolConcurrency,
  ) {
    super(
      `Nested tool concurrency cannot escalate from ${heldMode} to ${requestedMode} for operation ${operationId} (${heldResource} -> ${requestedResource})`,
    );
    this.name = "ToolConcurrencyEscalationError";
  }
}
export class ToolConcurrencyStaleLeaseError extends Error {
  readonly code = "TOOL_CONCURRENCY_STALE_LEASE";
  constructor(
    readonly operationId: string,
    readonly leaseId: number,
    readonly expectedGeneration: number,
    readonly actualGeneration: number,
  ) {
    super(
      `Tool operation ${operationId} inherited stale concurrency lease ${leaseId} (expected generation ${expectedGeneration}, actual ${actualGeneration})`,
    );
    this.name = "ToolConcurrencyStaleLeaseError";
  }
}
export class ToolConcurrencyLeaseAbortedError extends Error {
  readonly code = "TOOL_CONCURRENCY_LEASE_ABORTED";
  constructor(
    readonly operationId: string,
    readonly leaseId: number,
    options?: ErrorOptions,
  ) {
    super(
      `Tool operation ${operationId} inherited aborted concurrency lease ${leaseId}`,
      options,
    );
    this.name = "ToolConcurrencyLeaseAbortedError";
  }
}
/** Atomic multi-resource admission with resource-local fairness and nesting. */
export class ToolConcurrencyGate {
  private readonly context = new AsyncLocalStorage<LeaseContext>();
  private readonly active = new Set<Lease>();
  private readonly queue: PendingAdmission[] = [];
  private nextLeaseId = 1;
  private nextLegacyOperationId = 1;
  private draining = false;
  private readonly durable: ToolConcurrencyDurableCoordinator | undefined;

  constructor(options: ToolConcurrencyGateOptions = {}) {
    this.durable = options.durable
      ? new ToolConcurrencyDurableCoordinator(options.durable)
      : undefined;
  }

  run<T>(
    mode: ToolConcurrency,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T>;
  run<T>(
    request: ToolConcurrencyOperation,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T>;
  async run<T>(
    requestOrMode: ToolConcurrency | ToolConcurrencyOperation,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (typeof requestOrMode === "string") {
      return this.execute(
        `legacy:${this.nextLegacyOperationId++}`,
        [{ key: [], displayKey: "<run>", mode: requestOrMode }],
        signal,
        operation,
      );
    }
    return this.runWithResources(
      requestOrMode.operationId,
      requestOrMode.requirements,
      signal,
      operation,
    );
  }
  async runWithResources<T>(
    operationId: string,
    requirements: readonly ToolConcurrencyResourceRequirement[],
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.execute(
      normalizeToolConcurrencyOperationId(operationId),
      normalizeToolConcurrencyRequirements(requirements),
      signal,
      operation,
    );
  }
  private async execute<T>(
    operationId: string,
    requirements: readonly NormalizedRequirement[],
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    const parent = this.context.getStore();
    if (parent) {
      this.assertContextChainUsable(parent, operationId);
      assertNoNestedEscalation(operationId, requirements, parent);
    }
    const lease = await this.admit(operationId, requirements, signal, parent);
    const generation = lease.generation;
    try {
      const runLocally = () =>
        this.context.run({ lease, generation }, operation);
      if (!this.durable) return await runLocally();
      return await this.durable.run(
        {
          operationId,
          requirements,
          ancestorLeases: durableAncestorTokens(parent, operationId),
          ...(signal ? { signal } : {}),
        },
        async (durableLease) => {
          lease.durable = durableLease;
          return runLocally();
        },
      );
    } finally {
      this.release(lease);
    }
  }
  private admit(
    operationId: string,
    requirements: readonly NormalizedRequirement[],
    signal: AbortSignal | undefined,
    parent: LeaseContext | undefined,
  ): Promise<Lease> {
    return new Promise<Lease>((resolve, reject) => {
      if (signal?.aborted) {
        reject(cancellationReason(signal));
        return;
      }
      const entry: PendingAdmission = {
        operationId,
        requirements,
        ...(parent ? { parent } : {}),
        ...(signal ? { signal } : {}),
        resolve,
        reject,
        settled: false,
      };
      if (signal) {
        entry.abortListener = () => {
          if (!this.removePending(entry)) return;
          entry.settled = true;
          reject(cancellationReason(signal));
          this.drain();
        };
        signal.addEventListener("abort", entry.abortListener, { once: true });
      }
      this.queue.push(entry);
      this.drain();
    });
  }
  private drain(): void {
    if (this.draining) return;
    this.draining = true;
    try {
      let advanced = true;
      while (advanced) {
        advanced = false;
        for (let index = 0; index < this.queue.length; index += 1) {
          const entry = this.queue[index]!;
          const invalid = this.pendingInvalidReason(entry);
          if (invalid !== undefined) {
            this.queue.splice(index, 1);
            this.rejectPending(entry, invalid);
            index -= 1;
            advanced = true;
            continue;
          }
          if (!this.canStart(entry, index)) continue;
          this.queue.splice(index, 1);
          this.start(entry);
          index -= 1;
          advanced = true;
        }
      }
    } finally {
      this.draining = false;
    }
  }
  private pendingInvalidReason(entry: PendingAdmission): unknown | undefined {
    if (entry.signal?.aborted) return cancellationReason(entry.signal);
    if (!entry.parent) return undefined;
    try {
      this.assertContextChainUsable(entry.parent, entry.operationId);
      return undefined;
    } catch (error) {
      return error;
    }
  }
  private canStart(entry: PendingAdmission, queueIndex: number): boolean {
    for (const lease of this.active) {
      if (this.conflictsWithActive(entry, lease)) return false;
    }
    for (let index = 0; index < queueIndex; index += 1) {
      const earlier = this.queue[index]!;
      if (this.conflictsWithEarlierWaiter(entry, earlier)) return false;
    }
    return true;
  }
  private conflictsWithActive(entry: PendingAdmission, active: Lease): boolean {
    for (const [requested, held] of conflictingToolConcurrencyRequirementPairs(
      entry.requirements,
      active.requirements,
    )) {
      if (
        isLeaseInAncestry(active, entry.parent) &&
        toolConcurrencyRequirementCovers(held, requested)
      ) {
        continue;
      }
      return true;
    }
    return false;
  }
  private conflictsWithEarlierWaiter(
    entry: PendingAdmission,
    earlier: PendingAdmission,
  ): boolean {
    for (const [requested] of conflictingToolConcurrencyRequirementPairs(
      entry.requirements,
      earlier.requirements,
    )) {
      const coveringAncestor = findCoveringAncestor(entry.parent, requested);
      if (
        coveringAncestor &&
        !isLeaseInAncestry(coveringAncestor, earlier.parent)
      ) {
        continue;
      }
      return true;
    }
    return false;
  }
  private start(entry: PendingAdmission): void {
    if (entry.settled) return;
    if (entry.signal?.aborted) {
      this.rejectPending(entry, cancellationReason(entry.signal));
      return;
    }
    this.removeAbortListener(entry);
    const lease: Lease = {
      leaseId: this.nextLeaseId++,
      ownerOperationId: entry.operationId,
      requirements: entry.requirements,
      ...(entry.parent ? { parent: entry.parent } : {}),
      ...(entry.signal ? { signal: entry.signal } : {}),
      active: true,
      generation: 1,
    };
    if (entry.signal) {
      lease.abortListener = () => this.drain();
      entry.signal.addEventListener("abort", lease.abortListener, {
        once: true,
      });
    }
    entry.settled = true;
    this.active.add(lease);
    entry.resolve(lease);
  }
  private release(lease: Lease): void {
    if (!lease.active) return;
    lease.active = false;
    lease.generation += 1;
    if (lease.signal && lease.abortListener) {
      lease.signal.removeEventListener("abort", lease.abortListener);
    }
    this.active.delete(lease);
    this.drain();
  }
  private rejectPending(entry: PendingAdmission, reason: unknown): void {
    if (entry.settled) return;
    entry.settled = true;
    this.removeAbortListener(entry);
    entry.reject(reason);
  }
  private removePending(entry: PendingAdmission): boolean {
    const index = this.queue.indexOf(entry);
    if (index < 0) return false;
    this.queue.splice(index, 1);
    return true;
  }
  private removeAbortListener(entry: PendingAdmission): void {
    if (entry.signal && entry.abortListener) {
      entry.signal.removeEventListener("abort", entry.abortListener);
    }
  }
  private assertContextUsable(
    context: LeaseContext,
    operationId: string,
  ): void {
    const { lease } = context;
    if (!lease.active || lease.generation !== context.generation) {
      throw new ToolConcurrencyStaleLeaseError(
        operationId,
        lease.leaseId,
        context.generation,
        lease.generation,
      );
    }
    if (lease.signal?.aborted) {
      throw new ToolConcurrencyLeaseAbortedError(operationId, lease.leaseId, {
        cause: lease.signal.reason,
      });
    }
  }
  private assertContextChainUsable(
    context: LeaseContext,
    operationId: string,
  ): void {
    for (
      let current: LeaseContext | undefined = context;
      current;
      current = current.lease.parent
    ) {
      this.assertContextUsable(current, operationId);
    }
  }
}

function durableAncestorTokens(
  parent: LeaseContext | undefined,
  operationId: string,
): DurableToolConcurrencyLeaseToken[] {
  const tokens: DurableToolConcurrencyLeaseToken[] = [];
  for (let context = parent; context; context = context.lease.parent) {
    const durable = context.lease.durable;
    if (!durable) {
      throw new ToolConcurrencyStaleLeaseError(
        operationId,
        context.lease.leaseId,
        context.generation,
        context.lease.generation,
      );
    }
    tokens.push(durable);
  }
  return tokens;
}

function assertNoNestedEscalation(
  operationId: string,
  requirements: readonly NormalizedRequirement[],
  parent: LeaseContext,
): void {
  const ancestors: Lease[] = [];
  for (
    let context: LeaseContext | undefined = parent;
    context;
    context = context.lease.parent
  ) {
    ancestors.push(context.lease);
  }
  for (const requested of requirements) {
    const covered = ancestors.some((ancestor) =>
      ancestor.requirements.some((held) =>
        toolConcurrencyRequirementCovers(held, requested),
      ),
    );
    if (covered) {
      continue;
    }
    for (const ancestor of ancestors) {
      for (const held of ancestor.requirements) {
        if (!toolConcurrencyResourcesOverlap(requested.key, held.key)) continue;
        if (
          toolConcurrencyModeStrength(requested.mode) >
            toolConcurrencyModeStrength(held.mode) ||
          conflictingToolConcurrencyRequirementPairs([requested], [held])
            .length > 0
        ) {
          throw new ToolConcurrencyEscalationError(
            operationId,
            held.displayKey,
            held.mode,
            requested.displayKey,
            requested.mode,
          );
        }
      }
    }
  }
}
function findCoveringAncestor(
  parent: LeaseContext | undefined,
  requirement: NormalizedRequirement,
): Lease | undefined {
  for (let context = parent; context; context = context.lease.parent) {
    const ancestor = context.lease;
    if (
      ancestor.requirements.some((held) =>
        toolConcurrencyRequirementCovers(held, requirement),
      )
    ) {
      return ancestor;
    }
  }
  return undefined;
}
function isLeaseInAncestry(
  expectedAncestor: Lease,
  descendant: LeaseContext | undefined,
): boolean {
  for (let current = descendant; current; current = current.lease.parent) {
    if (current.lease === expectedAncestor) return true;
  }
  return false;
}
function cancellationReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("Tool call was cancelled");
}
