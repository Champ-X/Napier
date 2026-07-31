import { PersistentBrowserSession } from "./browser-page-session.js";
import {
  MAX_ACTIVE_BROWSER_SESSIONS,
  type BrowserSessionOperationResult,
  type BrowserSessionOwner,
  type BrowserSessionRequest,
  type RunBrowserSessionManagerOptions,
} from "./browser-session-model.js";
import { resolvePublicHost, validatePublicHttpUrl } from "./public-network.js";

export * from "./browser-session-model.js";
export { resolveBrowserRuntime } from "./browser-runtime.js";

export class RunBrowserSessionManager {
  private readonly sessions = new Map<string, PersistentBrowserSession>();
  private readonly tails = new Map<string, Promise<void>>();
  private startingSessions = 0;

  constructor(private readonly options: RunBrowserSessionManagerOptions) {}

  async execute(
    owner: BrowserSessionOwner,
    request: BrowserSessionRequest,
    signal?: AbortSignal,
  ): Promise<BrowserSessionOperationResult> {
    const key = ownerKey(owner);
    return this.serialized(
      key,
      async () => {
        assertNotAborted(signal);
        if (request.action === "start") {
          if (this.sessions.has(key)) {
            throw new Error("Browser Session is already active for this Run");
          }
          await this.pruneClosedSessions();
          if (
            this.sessions.size + this.startingSessions >=
            MAX_ACTIVE_BROWSER_SESSIONS
          ) {
            throw new Error("Browser active Session limit reached");
          }
          this.startingSessions += 1;
          let session: PersistentBrowserSession;
          try {
            await preflightStartUrl(request.url, this.options);
            assertNotAborted(signal);
            session = await PersistentBrowserSession.start(this.options);
          } finally {
            this.startingSessions -= 1;
          }
          this.sessions.set(key, session);
          try {
            return await this.runOperation(
              key,
              session,
              request,
              false,
              signal,
            );
          } catch (error) {
            this.sessions.delete(key);
            await session.close();
            throw error;
          }
        }
        const session = this.sessions.get(key);
        if (!session || !session.healthy) {
          if (session) {
            this.sessions.delete(key);
            await session.close();
          }
          throw new Error("Browser Session is not active for this Run");
        }
        return this.runOperation(key, session, request, true, signal);
      },
      signal,
    );
  }

  async cancelRun(owner: BrowserSessionOwner): Promise<void> {
    const key = ownerKey(owner);
    const session = this.sessions.get(key);
    this.sessions.delete(key);
    await session?.close();
  }

  private async runOperation(
    key: string,
    session: PersistentBrowserSession,
    request: BrowserSessionRequest,
    reused: boolean,
    signal?: AbortSignal,
  ): Promise<BrowserSessionOperationResult> {
    try {
      const result = await session.execute(request, reused, signal);
      if (request.action === "close") {
        this.sessions.delete(key);
        await session.close();
      }
      return result;
    } catch (error) {
      this.sessions.delete(key);
      await session.close();
      throw error;
    }
  }

  private async serialized<T>(
    key: string,
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.tails.set(key, tail);
    void tail.finally(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    try {
      await waitForTurn(previous, signal);
      return await operation();
    } finally {
      release();
    }
  }

  private async pruneClosedSessions(): Promise<void> {
    const closed = [...this.sessions.entries()].filter(
      ([, session]) => !session.healthy,
    );
    for (const [key] of closed) this.sessions.delete(key);
    await Promise.allSettled(closed.map(([, session]) => session.close()));
  }
}

function ownerKey(owner: BrowserSessionOwner): string {
  if (!owner.threadId || !owner.runId) {
    throw new Error("Browser Session owner is invalid");
  }
  return `${owner.threadId}\u0000${owner.runId}`;
}

async function preflightStartUrl(
  value: string,
  options: RunBrowserSessionManagerOptions,
): Promise<void> {
  const url = validatePublicHttpUrl(value);
  await resolvePublicHost(url.hostname, {
    ...(options.lookup ? { lookup: options.lookup } : {}),
  });
}

async function waitForTurn(
  previous: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    await previous.catch(() => undefined);
    return;
  }
  assertNotAborted(signal);
  let abort!: () => void;
  try {
    await Promise.race([
      previous.catch(() => undefined),
      new Promise<never>((_, reject) => {
        abort = () =>
          reject(new Error("Browser Session operation was cancelled"));
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Browser Session operation was cancelled");
  }
}
