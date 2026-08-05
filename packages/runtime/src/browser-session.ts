import { PersistentBrowserSession } from "./browser-page-session.js";
import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  MAX_ACTIVE_BROWSER_SESSIONS,
  BROWSER_VIEWPORT_HEIGHT,
  BROWSER_VIEWPORT_WIDTH,
  type BrowserPageSourceCapture,
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

  hasActiveSession(owner: BrowserSessionOwner): boolean {
    return this.sessions.get(ownerKey(owner))?.healthy === true;
  }

  async capturePage(
    owner: BrowserSessionOwner,
    maxChars: number,
    signal?: AbortSignal,
  ): Promise<BrowserPageSourceCapture> {
    const key = ownerKey(owner);
    return this.serialized(
      key,
      async () => {
        assertNotAborted(signal);
        const session = this.sessions.get(key);
        if (!session || !session.healthy) {
          throw new Error("Browser Session is not active for this Run");
        }
        try {
          return await session.capturePage(maxChars, signal);
        } catch (error) {
          this.sessions.delete(key);
          await session.close();
          throw error;
        }
      },
      signal,
    );
  }

  async captureLiveView(
    owner: BrowserSessionOwner,
    signal?: AbortSignal,
  ): Promise<{ image: Buffer; receipt: BrowserLiveViewReceipt }> {
    const key = ownerKey(owner);
    return this.serialized(
      key,
      async () => {
        assertNotAborted(signal);
        const session = this.sessions.get(key);
        if (!session || !session.healthy) {
          throw new Error("Browser Session is not active for this Run");
        }
        const result = await session.execute(
          { action: "screenshot" },
          true,
          undefined,
          false,
        );
        const image = Buffer.from(result.screenshot!.data, "base64");
        const details = result.details;
        const content = {
          kind: "napier.browser-live-view" as const,
          schemaVersion: 4 as const,
          threadId: owner.threadId,
          runId: owner.runId,
          sessionIdSha256: details.sessionIdSha256,
          sessionOperation: details.sessionOperation,
          activeTabId: details.activeTabId,
          tabCount: details.tabCount,
          tabSetSha256: details.tabSetSha256,
          imageSha256: details.screenshotSha256!,
          imageBytes: details.screenshotBytes!,
          mimeType: "image/png" as const,
          viewportWidth: BROWSER_VIEWPORT_WIDTH,
          viewportHeight: BROWSER_VIEWPORT_HEIGHT,
          capturedAt: new Date().toISOString(),
          currentUrlSha256: details.currentUrlSha256,
          currentOriginSha256: details.currentOriginSha256,
          titleSha256: details.titleSha256,
          browserExecutableSha256: details.browserExecutableSha256,
          browserVersionSha256: details.browserVersionSha256,
          limitsSha256: details.limitsSha256,
          networkRequestCount: details.network.requestCount,
          blockedRequestCount: details.blockedRequestCount,
          pageDiagnosis: details.pageDiagnosis,
        };
        return {
          image,
          receipt: {
            ...content,
            contentSha256: sha256(canonicalJson(content)),
          },
        };
      },
      signal,
    );
  }

  async captureTakeoverSnapshot(
    owner: BrowserSessionOwner,
    signal?: AbortSignal,
  ): Promise<{
    snapshot: BrowserSessionOperationResult;
    tabs: BrowserSessionOperationResult;
  }> {
    const key = ownerKey(owner);
    return this.serialized(
      key,
      async () => {
        assertNotAborted(signal);
        const session = this.sessions.get(key);
        if (!session || !session.healthy) {
          throw new Error("Browser Session is not active for this Run");
        }
        try {
          const snapshot = await session.execute(
            { action: "snapshot" },
            true,
            signal,
            false,
          );
          const tabs = await session.execute(
            { action: "tab_list" },
            true,
            signal,
            false,
          );
          if (
            snapshot.details.sessionIdSha256 !== tabs.details.sessionIdSha256 ||
            snapshot.details.sessionOperation !==
              tabs.details.sessionOperation ||
            snapshot.details.activeTabId !== tabs.details.activeTabId ||
            snapshot.details.tabCount !== tabs.details.tabCount ||
            snapshot.details.currentUrlSha256 !==
              tabs.details.currentUrlSha256 ||
            snapshot.details.currentOriginSha256 !==
              tabs.details.currentOriginSha256 ||
            snapshot.details.titleSha256 !== tabs.details.titleSha256 ||
            snapshot.details.snapshotSha256 !== tabs.details.snapshotSha256 ||
            snapshot.details.pageDiagnosis.status !==
              tabs.details.pageDiagnosis.status ||
            snapshot.details.pageDiagnosis.signalCount !==
              tabs.details.pageDiagnosis.signalCount ||
            snapshot.details.pageDiagnosis.signalsSha256 !==
              tabs.details.pageDiagnosis.signalsSha256 ||
            snapshot.details.pageDiagnosis.takeoverRecommended !==
              tabs.details.pageDiagnosis.takeoverRecommended ||
            snapshot.details.tabSetSha256 !== tabs.details.tabSetSha256
          ) {
            throw new Error("Browser takeover tab evidence changed");
          }
          return { snapshot, tabs };
        } catch (error) {
          this.sessions.delete(key);
          await session.close();
          throw error;
        }
      },
      signal,
    );
  }

  async executeTakeoverAction(
    owner: BrowserSessionOwner,
    request: Extract<
      BrowserSessionRequest,
      {
        action:
          | "click"
          | "visual_click"
          | "keypress"
          | "type"
          | "select"
          | "scroll"
          | "back"
          | "forward"
          | "tab_new"
          | "tab_switch"
          | "tab_close"
          | "wait";
      }
    >,
    signal?: AbortSignal,
  ): Promise<BrowserSessionOperationResult> {
    return await this.executeRequest(owner, request, signal);
  }

  async execute(
    owner: BrowserSessionOwner,
    request: BrowserSessionRequest,
    signal?: AbortSignal,
  ): Promise<BrowserSessionOperationResult> {
    if (request.action === "visual_click" || request.action === "keypress") {
      throw new Error(
        "Browser visual and keyboard actions require pause-bound takeover",
      );
    }
    return await this.executeRequest(owner, request, signal);
  }

  private async executeRequest(
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
