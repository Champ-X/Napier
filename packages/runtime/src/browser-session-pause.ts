import type { JsonObject } from "@napier/contracts";
import type { BrowserSessionPauseState } from "@napier/contracts/browser-session-control";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";

interface PendingResume {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
  sessionCheck?: ReturnType<typeof setInterval>;
  settling?: boolean;
}

const SESSION_HEALTH_CHECK_MS = 250;

export class BrowserSessionPauseManager {
  private readonly paused = new Map<string, BrowserSessionPauseState>();
  private readonly waiters = new Map<string, Set<PendingResume>>();
  private readonly transitions = new Map<string, Promise<void>>();

  constructor(private readonly store: Pick<LocalStore, "appendEvent">) {}

  state(owner: { threadId: string; runId: string }): BrowserSessionPauseState {
    return structuredClone(
      this.paused.get(ownerKey(owner)) ?? createState(owner, "running"),
    );
  }

  async pause(owner: {
    threadId: string;
    runId: string;
  }): Promise<BrowserSessionPauseState> {
    const key = ownerKey(owner);
    const current = this.paused.get(key);
    if (current) {
      return await this.serialized(key, async () => {
        const settled = this.paused.get(key);
        if (settled) return structuredClone(settled);
        const retry = createState(owner, "paused", {
          pauseRequestedAt: new Date().toISOString(),
        });
        this.paused.set(key, retry);
        return await this.appendPausedState(key, retry);
      });
    }
    const state = createState(owner, "paused", {
      pauseRequestedAt: new Date().toISOString(),
    });
    this.paused.set(key, state);
    return await this.serialized(key, () => this.appendPausedState(key, state));
  }

  async resume(
    owner: {
      threadId: string;
      runId: string;
    },
    expectedPauseStateSha256?: string,
  ): Promise<BrowserSessionPauseState> {
    const key = ownerKey(owner);
    return await this.serialized(key, async () => {
      const current = this.paused.get(key);
      if (!current) throw new Error("Browser Session is not paused");
      if (
        expectedPauseStateSha256 !== undefined &&
        expectedPauseStateSha256 !== current.contentSha256
      ) {
        throw new Error("Browser Session pause state changed");
      }
      const state = createState(owner, "running", {
        ...(current.pauseRequestedAt
          ? { pauseRequestedAt: current.pauseRequestedAt }
          : {}),
        resumedAt: new Date().toISOString(),
      });
      await this.append(state, "browser.session_pause.resumed");
      this.paused.delete(key);
      this.settle(key);
      return state;
    });
  }

  async waitIfPaused(
    owner: { threadId: string; runId: string },
    signal?: AbortSignal,
    sessionActive?: () => boolean,
  ): Promise<void> {
    const key = ownerKey(owner);
    if (!this.paused.has(key)) return;
    if (signal?.aborted) throw cancelled();
    if (sessionActive && !isSessionActive(sessionActive)) {
      await this.cancelRun(owner);
      throw sessionUnavailable();
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: PendingResume = {
        resolve,
        reject,
        ...(signal ? { signal } : {}),
      };
      if (signal) {
        waiter.abort = () => {
          this.removeWaiter(key, waiter);
          reject(cancelled());
        };
        signal.addEventListener("abort", waiter.abort, { once: true });
      }
      if (sessionActive) {
        waiter.sessionCheck = setInterval(() => {
          if (waiter.settling || isSessionActive(sessionActive)) return;
          waiter.settling = true;
          this.removeWaiter(key, waiter);
          void this.cancelRun(owner).then(
            () => reject(sessionUnavailable()),
            () => reject(sessionUnavailable()),
          );
        }, SESSION_HEALTH_CHECK_MS);
      }
      const waiters = this.waiters.get(key) ?? new Set<PendingResume>();
      waiters.add(waiter);
      this.waiters.set(key, waiters);
      if (!this.paused.has(key)) {
        this.removeWaiter(key, waiter);
        resolve();
      }
    });
  }

  runWhilePaused<T>(
    owner: { threadId: string; runId: string },
    expectedPauseStateSha256: string | undefined,
    operation: (state: BrowserSessionPauseState) => Promise<T>,
  ): Promise<T> {
    const key = ownerKey(owner);
    return this.serialized(key, async () => {
      const current = this.paused.get(key);
      if (!current) throw new Error("Browser Session is not paused");
      if (
        expectedPauseStateSha256 !== undefined &&
        current.contentSha256 !== expectedPauseStateSha256
      ) {
        throw new Error("Browser Session pause state changed");
      }
      return await operation(structuredClone(current));
    });
  }

  async cancelRun(owner: { threadId: string; runId: string }): Promise<void> {
    const key = ownerKey(owner);
    await this.serialized(key, async () => {
      const current = this.paused.get(key);
      if (!current) {
        this.settle(key, cancelled());
        return;
      }
      const state = createState(owner, "cancelled", {
        ...(current.pauseRequestedAt
          ? { pauseRequestedAt: current.pauseRequestedAt }
          : {}),
        cancelledAt: new Date().toISOString(),
      });
      await this.append(state, "browser.session_pause.cancelled").catch(
        () => undefined,
      );
      this.paused.delete(key);
      this.settle(key, cancelled());
    });
  }

  private serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.transitions.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    this.transitions.set(key, tail);
    void tail.finally(() => {
      if (this.transitions.get(key) === tail) {
        this.transitions.delete(key);
      }
    });
    return current;
  }

  private async appendPausedState(
    key: string,
    state: BrowserSessionPauseState,
  ): Promise<BrowserSessionPauseState> {
    try {
      await this.append(state, "browser.session_pause.requested");
      return structuredClone(state);
    } catch (error) {
      if (this.paused.get(key)?.contentSha256 === state.contentSha256) {
        this.paused.delete(key);
      }
      this.settle(
        key,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  private settle(key: string, error?: Error): void {
    const waiters = this.waiters.get(key);
    this.waiters.delete(key);
    for (const waiter of waiters ?? []) {
      if (waiter.signal && waiter.abort) {
        waiter.signal.removeEventListener("abort", waiter.abort);
      }
      if (waiter.sessionCheck) clearInterval(waiter.sessionCheck);
      if (error) waiter.reject(error);
      else waiter.resolve();
    }
  }

  private removeWaiter(key: string, waiter: PendingResume): void {
    const waiters = this.waiters.get(key);
    waiters?.delete(waiter);
    if (waiters?.size === 0) this.waiters.delete(key);
    if (waiter.signal && waiter.abort) {
      waiter.signal.removeEventListener("abort", waiter.abort);
    }
    if (waiter.sessionCheck) clearInterval(waiter.sessionCheck);
  }

  private async append(
    state: BrowserSessionPauseState,
    type:
      | "browser.session_pause.cancelled"
      | "browser.session_pause.requested"
      | "browser.session_pause.resumed",
  ): Promise<void> {
    await this.store.appendEvent({
      threadId: state.threadId,
      runId: state.runId,
      type,
      category: "tool",
      visibility: "user",
      payload: JSON.parse(JSON.stringify(state)) as JsonObject,
    });
  }
}

function createState(
  owner: { threadId: string; runId: string },
  status: BrowserSessionPauseState["status"],
  timestamps: {
    pauseRequestedAt?: string;
    resumedAt?: string;
    cancelledAt?: string;
  } = {},
): BrowserSessionPauseState {
  const content = {
    kind: "napier.browser-session-pause-state" as const,
    schemaVersion: 1 as const,
    threadId: owner.threadId,
    runId: owner.runId,
    status,
    ...timestamps,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function ownerKey(owner: { threadId: string; runId: string }): string {
  if (!owner.threadId || !owner.runId) {
    throw new Error("Browser Session pause owner is invalid");
  }
  return `${owner.threadId}\u0000${owner.runId}`;
}

function cancelled(): Error {
  return new Error("Browser Session pause wait was cancelled");
}

function sessionUnavailable(): Error {
  return new Error("Browser Session closed while paused");
}

function isSessionActive(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}
