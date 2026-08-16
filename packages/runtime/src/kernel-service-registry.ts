export interface KernelServiceKey<T> {
  readonly id: string;
  readonly token: symbol;
  readonly _type?: T;
}

export interface KernelServiceResolver {
  resolve<T>(key: KernelServiceKey<T>): Promise<T>;
  require<T>(key: KernelServiceKey<T>): T;
}

export interface KernelServiceRegistration<T> {
  key: KernelServiceKey<T>;
  dependencies?: readonly KernelServiceKey<unknown>[];
  create(resolver: KernelServiceResolver): T | Promise<T>;
  dispose?(value: T): void | Promise<void>;
}

export interface KernelServiceInspection {
  id: string;
  owner: string;
  state: "registered" | "resolved";
  dependencies: string[];
}

interface StoredRegistration<T = unknown> extends KernelServiceRegistration<T> {
  owner: string;
}

const SERVICE_ID = /^[a-z][a-z0-9_.-]{2,79}$/u;

export function createKernelServiceKey<T>(id: string): KernelServiceKey<T> {
  if (!SERVICE_ID.test(id))
    throw new Error(`Kernel service ID is invalid: ${id}`);
  return Object.freeze({ id, token: Symbol(id) });
}

export class KernelServiceRegistry implements KernelServiceResolver {
  private readonly registrations = new Map<string, StoredRegistration>();
  private readonly values = new Map<string, unknown>();
  private readonly resolutionOrder: string[] = [];
  private readonly resolving: string[] = [];
  private closed = false;

  register<T>(
    registration: KernelServiceRegistration<T>,
    owner = "kernel",
  ): void {
    this.assertOpen();
    if (this.registrations.has(registration.key.id)) {
      throw new Error(
        `Kernel service is already registered: ${registration.key.id}`,
      );
    }
    this.registrations.set(registration.key.id, { ...registration, owner });
  }

  scope(owner: string): KernelServiceScope {
    this.assertOpen();
    if (!SERVICE_ID.test(owner))
      throw new Error(`Kernel owner ID is invalid: ${owner}`);
    return new KernelServiceScope(this, owner);
  }

  async resolve<T>(key: KernelServiceKey<T>): Promise<T> {
    this.assertOpen();
    if (this.values.has(key.id)) return this.values.get(key.id) as T;
    const registration = this.registration(key);
    const cycleIndex = this.resolving.indexOf(key.id);
    if (cycleIndex >= 0) {
      throw new Error(
        `Kernel service dependency cycle: ${[
          ...this.resolving.slice(cycleIndex),
          key.id,
        ].join(" -> ")}`,
      );
    }
    this.resolving.push(key.id);
    try {
      for (const dependency of registration.dependencies ?? []) {
        await this.resolve(dependency);
      }
      const value = await registration.create(this);
      this.values.set(key.id, value);
      this.resolutionOrder.push(key.id);
      return value as T;
    } finally {
      this.resolving.pop();
    }
  }

  require<T>(key: KernelServiceKey<T>): T {
    this.assertOpen();
    if (!this.values.has(key.id)) {
      throw new Error(`Kernel service is not resolved: ${key.id}`);
    }
    return this.values.get(key.id) as T;
  }

  inspect(): KernelServiceInspection[] {
    return [...this.registrations.values()]
      .map((registration) => ({
        id: registration.key.id,
        owner: registration.owner,
        state: this.values.has(registration.key.id)
          ? ("resolved" as const)
          : ("registered" as const),
        dependencies: (registration.dependencies ?? []).map(
          (dependency) => dependency.id,
        ),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async resolveOwner(owner: string): Promise<void> {
    this.assertOpen();
    const keys = [...this.registrations.values()]
      .filter((registration) => registration.owner === owner)
      .map((registration) => registration.key)
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const key of keys) await this.resolve(key);
  }

  async disposeOwner(owner: string): Promise<void> {
    this.assertOpen();
    const owned = new Set(
      [...this.registrations.values()]
        .filter((registration) => registration.owner === owner)
        .map((registration) => registration.key.id),
    );
    if (owned.size === 0) return;
    const dependent = [...this.registrations.values()].find(
      (registration) =>
        registration.owner !== owner &&
        (registration.dependencies ?? []).some((dependency) =>
          owned.has(dependency.id),
        ),
    );
    if (dependent) {
      throw new Error(
        `Kernel owner ${owner} still provides dependency for ${dependent.key.id}`,
      );
    }
    await this.disposeIds(owned);
    for (const id of owned) this.registrations.delete(id);
  }

  async shutdown(): Promise<void> {
    if (this.closed) return;
    await this.disposeIds(new Set(this.registrations.keys()));
    this.registrations.clear();
    this.closed = true;
  }

  private async disposeIds(ids: ReadonlySet<string>): Promise<void> {
    const failures: unknown[] = [];
    for (const id of [...this.resolutionOrder].reverse()) {
      if (!ids.has(id) || !this.values.has(id)) continue;
      const registration = this.registrations.get(id);
      const value = this.values.get(id);
      try {
        await registration?.dispose?.(value);
      } catch (error) {
        failures.push(error);
      }
      this.values.delete(id);
      this.resolutionOrder.splice(this.resolutionOrder.lastIndexOf(id), 1);
    }
    if (failures.length > 0) throw failures[0];
  }

  private registration<T>(key: KernelServiceKey<T>): StoredRegistration<T> {
    const registration = this.registrations.get(key.id);
    if (!registration)
      throw new Error(`Kernel service is not registered: ${key.id}`);
    return registration as StoredRegistration<T>;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Kernel service registry is closed");
  }
}

export class KernelServiceScope {
  private disposed = false;

  constructor(
    private readonly registry: KernelServiceRegistry,
    readonly owner: string,
  ) {}

  register<T>(registration: KernelServiceRegistration<T>): void {
    if (this.disposed)
      throw new Error(`Kernel owner is disposed: ${this.owner}`);
    this.registry.register(registration, this.owner);
  }

  resolve(): Promise<void> {
    if (this.disposed)
      throw new Error(`Kernel owner is disposed: ${this.owner}`);
    return this.registry.resolveOwner(this.owner);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.registry.disposeOwner(this.owner);
    this.disposed = true;
  }
}
