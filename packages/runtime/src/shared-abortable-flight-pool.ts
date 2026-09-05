interface SharedFlight<T> {
  readonly controller: AbortController;
  readonly promise: Promise<T>;
  subscribers: number;
  settled: boolean;
}

/**
 * Coalesces equivalent in-flight work while retaining per-subscriber
 * cancellation. A flight is aborted only after its final subscriber leaves;
 * cancelling a scope fences and drains every flight before state is released.
 */
export class SharedAbortableFlightPool<T> {
  private readonly scopes = new Map<string, Map<string, SharedFlight<T>>>();
  private nextUnsharedId = 1;

  async run(
    scopeKey: string,
    workKey: string,
    subscriberSignal: AbortSignal,
    start: (flightSignal: AbortSignal) => Promise<T>,
    coalesce = true,
  ): Promise<T> {
    throwIfAborted(subscriberSignal);
    const scope = this.scope(scopeKey);
    const effectiveWorkKey = coalesce
      ? workKey
      : `${workKey}:unshared:${String(this.nextUnsharedId++)}`;
    let flight = scope.get(effectiveWorkKey);
    if (flight && (flight.settled || flight.controller.signal.aborted)) {
      scope.delete(effectiveWorkKey);
      flight = undefined;
    }
    if (!flight) {
      flight = this.createFlight(scopeKey, effectiveWorkKey, scope, start);
      scope.set(effectiveWorkKey, flight);
    }
    flight.subscribers += 1;
    try {
      return await waitForFlight(flight.promise, subscriberSignal);
    } finally {
      flight.subscribers -= 1;
      if (flight.subscribers === 0 && !flight.settled) {
        flight.controller.abort();
      }
    }
  }

  async cancelScope(scopeKey: string): Promise<void> {
    const scope = this.scopes.get(scopeKey);
    if (!scope) return;
    // Detach the cancelled generation before awaiting it. New work therefore
    // enters a fresh scope which the old drain can neither observe nor delete.
    if (this.scopes.get(scopeKey) === scope) this.scopes.delete(scopeKey);
    for (const flight of scope.values()) flight.controller.abort();
    await Promise.allSettled(
      [...scope.values()].map((flight) => flight.promise),
    );
  }

  private createFlight(
    scopeKey: string,
    workKey: string,
    scope: Map<string, SharedFlight<T>>,
    start: (flightSignal: AbortSignal) => Promise<T>,
  ): SharedFlight<T> {
    const controller = new AbortController();
    let created!: SharedFlight<T>;
    const promise = Promise.resolve()
      .then(() => start(controller.signal))
      .finally(() => {
        created.settled = true;
        if (scope.get(workKey) === created) scope.delete(workKey);
        if (scope.size === 0 && this.scopes.get(scopeKey) === scope) {
          this.scopes.delete(scopeKey);
        }
      });
    created = { controller, promise, subscribers: 0, settled: false };
    return created;
  }

  private scope(scopeKey: string): Map<string, SharedFlight<T>> {
    const existing = this.scopes.get(scopeKey);
    if (existing) return existing;
    const created = new Map<string, SharedFlight<T>>();
    this.scopes.set(scopeKey, created);
    return created;
  }
}

function waitForFlight<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(abortReason(signal));
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Operation aborted", "AbortError");
}
