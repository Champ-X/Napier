import type { WorkspaceRuntimeCatalog } from "./workspace-runtime-catalog.js";
import {
  verifyWorkspaceRuntimeIdentity,
  type WorkspaceRuntimeIdentity,
} from "./workspace-runtime-identity.js";

export interface WorkspaceRuntimeLease<T> {
  identity: WorkspaceRuntimeIdentity;
  runtime: T;
  release(): void;
}

interface Resident<T> {
  identity: WorkspaceRuntimeIdentity;
  ready: Promise<T>;
  pins: number;
  lastUsed: number;
  runtime?: T;
  retiring?: Promise<void>;
  disposalFailed?: boolean;
  unpinned?: () => void;
}

export interface WorkspaceRuntimeRegistryOptions<T> {
  catalog: WorkspaceRuntimeCatalog;
  prepare(identity: WorkspaceRuntimeIdentity): Promise<T>;
  dispose(runtime: T): Promise<void>;
  /** Must protect active executions and all future background obligations. */
  canDispose(runtime: T): boolean;
  maxResident?: number;
  maxIdle?: number;
  idleMs?: number;
  now?: () => number;
}

/** View selection is deliberately absent. A graph belongs to a workspace. */
export class WorkspaceRuntimeRegistry<T> {
  private readonly residents = new Map<string, Resident<T>>();
  private readonly maxResident: number;
  private readonly maxIdle: number;
  private readonly idleMs: number;
  private readonly now: () => number;
  private closing = false;
  private shutdownPromise?: Promise<void>;

  constructor(private readonly options: WorkspaceRuntimeRegistryOptions<T>) {
    this.maxResident = boundedInteger(options.maxResident ?? 12, 1, 256);
    this.maxIdle = boundedInteger(options.maxIdle ?? Math.min(3, this.maxResident), 0, this.maxResident);
    this.idleMs = boundedInteger(options.idleMs ?? 300_000, 0, 86_400_000);
    this.now = options.now ?? Date.now;
  }

  async acquire(workspaceId: string): Promise<WorkspaceRuntimeLease<T>> {
    if (this.closing) throw new Error("Workspace registry is shutting down");
    const previous = this.residents.get(workspaceId);
    if (previous?.retiring) {
      await previous.retiring;
      return this.acquire(workspaceId);
    }
    if (previous?.disposalFailed) throw new Error("Workspace runtime cleanup requires reconciliation");
    let entry = previous;
    if (!entry) {
      // Register the loading entry before the first await, so concurrent callers
      // share preparation and cold starts count toward the resident bound.
      if (this.residents.size >= this.maxResident) {
        const idle = this.idleEntries()[0];
        if (!idle) throw new Error("Workspace runtime capacity reached; active work is retained");
        await this.retire(idle);
        return this.acquire(workspaceId);
      }
      const identity = this.options.catalog.get(workspaceId);
      const created: Resident<T> = {
        identity, ready: Promise.resolve().then(() => this.prepare(created)),
        pins: 0, lastUsed: this.now(),
      };
      this.residents.set(workspaceId, created);
      entry = created;
    }
    entry.pins += 1;
    try {
      const runtime = await entry.ready;
      const held = entry;
      let released = false;
      return {
        identity: { ...entry.identity }, runtime,
        release: () => {
          if (released) return;
          released = true;
          held.pins -= 1;
          held.lastUsed = this.now();
          if (held.pins === 0) held.unpinned?.();
        },
      };
    } catch (error) {
      entry.pins -= 1;
      if (entry.pins === 0) entry.unpinned?.();
      throw error;
    }
  }

  async withRuntime<R>(workspaceId: string, operation: (runtime: T) => Promise<R>): Promise<R> {
    const lease = await this.acquire(workspaceId);
    try { return await operation(lease.runtime); }
    finally { lease.release(); }
  }

  async reclaimIdle(): Promise<string[]> {
    const reclaimed: string[] = [];
    const idle = this.idleEntries();
    const excess = Math.max(0, idle.length - this.maxIdle);
    for (const [index, entry] of idle.entries()) {
      if (index >= excess && this.now() - entry.lastUsed < this.idleMs) continue;
      // Every await allows a request or worker to begin; recheck each candidate.
      if (!this.isIdle(entry)) continue;
      await this.retire(entry);
      reclaimed.push(entry.identity.workspaceId);
    }
    return reclaimed;
  }

  /** Restore every registration, including custom data roots; report individual failures. */
  async restore(): Promise<Array<{ workspaceId: string; error: string }>> {
    const failures: Array<{ workspaceId: string; error: string }> = [];
    for (const identity of this.options.catalog.list()) {
      try {
        const lease = await this.acquire(identity.workspaceId);
        lease.release();
      } catch (error) {
        failures.push({ workspaceId: identity.workspaceId, error: String(error) });
      }
    }
    return failures;
  }

  shutdown(): Promise<void> {
    this.closing = true;
    this.shutdownPromise ??= this.drain();
    return this.shutdownPromise;
  }

  private async prepare(entry: Resident<T>): Promise<T> {
    let claimed = false;
    try {
      await verifyWorkspaceRuntimeIdentity(entry.identity);
      this.options.catalog.claim(entry.identity.workspaceId);
      claimed = true;
      const runtime = await this.options.prepare({ ...entry.identity });
      entry.runtime = runtime;
      return runtime;
    } catch (error) {
      if (claimed) this.options.catalog.release(entry.identity.workspaceId);
      this.residents.delete(entry.identity.workspaceId);
      throw error;
    }
  }

  private isIdle(entry: Resident<T>): boolean {
    return this.residents.get(entry.identity.workspaceId) === entry &&
      entry.pins === 0 && entry.runtime !== undefined && !entry.retiring &&
      !entry.disposalFailed && this.options.canDispose(entry.runtime);
  }

  private idleEntries(): Resident<T>[] {
    return [...this.residents.values()].filter((entry) => this.isIdle(entry))
      .sort((left, right) => left.lastUsed - right.lastUsed);
  }

  private retire(entry: Resident<T>): Promise<void> {
    entry.retiring ??= this.dispose(entry);
    return entry.retiring;
  }

  private async dispose(entry: Resident<T>): Promise<void> {
    try {
      const runtime = await entry.ready;
      await this.options.dispose(runtime);
      this.options.catalog.release(entry.identity.workspaceId);
      this.residents.delete(entry.identity.workspaceId);
    } catch (error) {
      entry.disposalFailed = true;
      throw error;
    } finally {
      delete entry.retiring;
    }
  }

  private async drain(): Promise<void> {
    const outcomes = await Promise.allSettled([...this.residents.values()].map(async (entry) => {
      if (entry.pins > 0) await new Promise<void>((resolve) => { entry.unpinned = resolve; });
      if (this.residents.get(entry.identity.workspaceId) !== entry) return;
      await this.retire(entry);
    }));
    const failures = outcomes.filter((item) => item.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map((item) => item.reason), "Workspace shutdown failed");
  }
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error("Invalid workspace registry resource policy");
  }
  return value;
}
