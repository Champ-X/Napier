import { BrowserSessionCleanupError } from "./browser-session-cleanup.js";
import { MAX_ACTIVE_BROWSER_SESSIONS } from "./browser-session-limits.js";
import { waitForBrowserSessionTurn } from "./browser-session-shutdown.js";

interface OwnedBrowserSession {
  healthy: boolean;
  close(): Promise<void>;
}

/** Own preparation, serialized operations and failed cleanup until shutdown has
 * drained them. Terminal UI state or a removed map entry is not cleanup proof. */
export class BrowserSessionLifetime<T extends OwnedBrowserSession> {
  readonly sessions = new Map<string, T>();
  readonly shutdownController = new AbortController();
  private readonly tails = new Map<string, Promise<void>>();
  private readonly startupFailures = new Set<BrowserSessionCleanupError>();
  private starting = 0;
  private closed = false;
  private stopping: Promise<void> | undefined;

  async start(key: string, operation: () => Promise<T>): Promise<T> {
    this.assertOpen();
    if (this.sessions.size + this.starting + this.startupFailures.size >= MAX_ACTIVE_BROWSER_SESSIONS) {
      throw new Error("Browser active Session limit reached");
    }
    this.starting += 1;
    let session: T | undefined;
    try {
      session = await operation();
      this.sessions.set(key, session);
      if (this.closed) {
        await this.close(key, session);
        this.assertOpen();
      }
      return session;
    } catch (error) {
      if (!session && error instanceof BrowserSessionCleanupError) this.startupFailures.add(error);
      throw error;
    } finally {
      this.starting -= 1;
    }
  }

  async close(key: string, session: T): Promise<void> {
    await session.close();
    if (this.sessions.get(key) === session) this.sessions.delete(key);
  }

  async fail(key: string, session: T, error: unknown): Promise<never> {
    try { await this.close(key, session); }
    catch (cleanup) {
      if (cleanup === error) throw error;
      throw new AggregateError([error, cleanup], "Browser Session operation failed and resources did not close", { cause: error });
    }
    throw error;
  }

  async closeEntries(entries: ReadonlyArray<readonly [string, T]>): Promise<void> {
    const results = await Promise.allSettled(entries.map(([key, session]) => this.close(key, session)));
    const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, "Browser Sessions did not close");
  }

  async prune(): Promise<void> {
    await this.closeEntries([...this.sessions].filter(([, session]) => !session.healthy));
  }

  async serialized<R>(key: string, operation: () => Promise<R>, signal?: AbortSignal): Promise<R> {
    this.assertOpen();
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.tails.set(key, tail);
    void tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    try {
      await waitForBrowserSessionTurn(previous, signal);
      this.assertOpen();
      return await operation();
    } finally { release(); }
  }

  shutdown(): Promise<void> {
    if (!this.stopping) {
      this.closed = true;
      this.stopping = Promise.resolve().then(() => this.drain());
      this.shutdownController.abort(new Error("Browser Session Manager is shutting down"));
    }
    return this.stopping;
  }

  private async drain(): Promise<void> {
    const failures = new Set<unknown>(this.startupFailures);
    const closeCurrent = async () => {
      const results = await Promise.allSettled([...this.sessions].map(([key, session]) => this.close(key, session)));
      for (const result of results) if (result.status === "rejected") failures.add(result.reason);
    };
    // Interrupt existing browser work before draining it. Admitted late starts
    // close themselves, and queued operations see the closed admission gate.
    await closeCurrent();
    await Promise.allSettled([...this.tails.values()]);
    await closeCurrent();
    for (const failure of this.startupFailures) failures.add(failure);
    if (failures.size) throw new AggregateError([...failures], "Browser Session shutdown did not release all resources");
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Browser Session Manager is shutting down");
  }
}
