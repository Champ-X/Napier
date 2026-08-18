interface WorkspaceServiceGraphEntry<T> {
  graph: T;
  lastUsed: number;
}

export interface WorkspaceServiceGraphCacheOptions<T> {
  initialRoot: string;
  initialGraph: T;
  maxEntries?: number;
  prepare(root: string): Promise<T>;
  pause(graph: T): Promise<void>;
  resume(graph: T): void;
  activate(graph: T): void;
  dispose(graph: T): Promise<void>;
  onDisposeError(root: string, error: unknown): void;
}

/**
 * Keeps recently used workspace runtimes warm while ensuring that only the
 * active graph runs background workers. Cold preparation happens before the
 * current graph is paused, so preparation failures cannot disrupt the app.
 */
export class WorkspaceServiceGraphCache<T> {
  private readonly entries = new Map<string, WorkspaceServiceGraphEntry<T>>();
  private readonly preparations = new Map<string, Promise<T>>();
  private readonly pendingDisposals = new Map<string, Promise<void>>();
  private readonly protectedRoots = new Set<string>();
  private readonly maxEntries: number;
  private activeRoot: string;
  private useCounter = 0;
  private closed = false;

  constructor(private readonly options: WorkspaceServiceGraphCacheOptions<T>) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 3);
    this.activeRoot = options.initialRoot;
    this.entries.set(options.initialRoot, {
      graph: options.initialGraph,
      lastUsed: this.nextUse(),
    });
  }

  current(): T {
    return this.entry(this.activeRoot).graph;
  }

  has(root: string): boolean {
    return this.entries.has(root);
  }

  async prewarm(root: string): Promise<T> {
    this.assertOpen();
    const graph = await this.graphFor(root);
    this.touch(root);
    this.evictInactiveEntries();
    return graph;
  }

  async switchTo(root: string): Promise<T> {
    this.assertOpen();
    if (root === this.activeRoot) return this.current();

    const previousRoot = this.activeRoot;
    this.protectedRoots.add(previousRoot);
    this.protectedRoots.add(root);
    try {
      // A cold graph is fully prepared while the previous one remains live.
      const candidate = await this.graphFor(root);
      const previous = this.entry(previousRoot).graph;
      try {
        await this.options.pause(previous);
      } catch (error) {
        // A stop operation may have cleared some timers before failing. Make
        // the still-authoritative graph fully live again before surfacing it.
        this.options.resume(previous);
        throw error;
      }
      try {
        this.options.resume(candidate);
        this.options.activate(candidate);
      } catch (error) {
        await this.options
          .pause(candidate)
          .catch((pauseError: unknown) =>
            this.options.onDisposeError(root, pauseError),
          );
        this.options.resume(previous);
        this.options.activate(previous);
        throw error;
      }
      this.activeRoot = root;
      this.touch(previousRoot);
      this.touch(root);
      return candidate;
    } finally {
      this.protectedRoots.delete(previousRoot);
      this.protectedRoots.delete(root);
      this.evictInactiveEntries();
    }
  }

  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled(this.preparations.values());
    const entries = [...this.entries.entries()];
    this.entries.clear();
    await Promise.all([
      ...entries.map(([root, entry]) => this.dispose(root, entry.graph, true)),
      ...this.pendingDisposals.values(),
    ]);
  }

  private async graphFor(root: string): Promise<T> {
    await this.pendingDisposals.get(root);
    const cached = this.entries.get(root);
    if (cached) return cached.graph;
    const preparing = this.preparations.get(root);
    if (preparing) return preparing;

    const preparation = this.options
      .prepare(root)
      .then((graph) => {
        this.entries.set(root, { graph, lastUsed: this.nextUse() });
        return graph;
      })
      .finally(() => this.preparations.delete(root));
    this.preparations.set(root, preparation);
    return preparation;
  }

  private evictInactiveEntries(): void {
    while (this.entries.size > this.maxEntries) {
      const candidate = [...this.entries.entries()]
        .filter(
          ([root]) =>
            root !== this.activeRoot && !this.protectedRoots.has(root),
        )
        .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
      if (!candidate) return;
      const [root, entry] = candidate;
      this.entries.delete(root);
      void this.dispose(root, entry.graph, false);
    }
  }

  private async dispose(root: string, graph: T, wait: boolean): Promise<void> {
    const disposal = Promise.resolve()
      .then(() => this.options.dispose(graph))
      .catch((error: unknown) => this.options.onDisposeError(root, error));
    this.pendingDisposals.set(root, disposal);
    void disposal.finally(() => {
      if (this.pendingDisposals.get(root) === disposal) {
        this.pendingDisposals.delete(root);
      }
    });
    if (wait) await disposal;
  }

  private entry(root: string): WorkspaceServiceGraphEntry<T> {
    const entry = this.entries.get(root);
    if (!entry) throw new Error(`Workspace service graph is missing: ${root}`);
    return entry;
  }

  private touch(root: string): void {
    const entry = this.entries.get(root);
    if (entry) entry.lastUsed = this.nextUse();
  }

  private nextUse(): number {
    this.useCounter += 1;
    return this.useCounter;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Workspace service graph cache is closed");
  }
}
