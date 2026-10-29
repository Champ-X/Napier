import { PersistentBrowserSession } from "./browser-page-session.js";
import { BrowserSessionLifetime } from "./browser-session-lifetime.js";
import { BrowserNavigationPolicyError } from "./browser-session-navigation.js";
import {
  BrowserSessionInactiveError,
  BrowserTargetTimeoutError,
} from "./browser-session-errors.js";
import {
  browserSessionOwnerKey,
  isBrowserNavigationTimeout,
  preflightBrowserStartUrl,
} from "./browser-session-manager-helpers.js";
import {
  BrowserConfirmationPageChangedError,
  type BrowserConfirmationPageState,
} from "./browser-confirmed-action.js";
import { BrowserConfirmedSessionExecutor } from "./browser-confirmed-session.js";
import {
  assertBrowserPreparedUpload,
  type BrowserPreparedUpload,
} from "./browser-workspace-files.js";
import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  BROWSER_VIEWPORT_HEIGHT,
  BROWSER_VIEWPORT_WIDTH,
  type BrowserPageSourceCapture,
  type BrowserSessionOperationResult,
  type BrowserSessionOwner,
  type BrowserSessionRequest,
  type RunBrowserSessionManagerOptions,
} from "./browser-session-model.js";
import {
  assertBrowserSessionNotAborted,
} from "./browser-session-shutdown.js";

export * from "./browser-session-model.js";
export { resolveBrowserRuntime } from "./browser-runtime.js";

export class RunBrowserSessionManager {
  private readonly lifetime = new BrowserSessionLifetime<PersistentBrowserSession>();
  private readonly sessions = this.lifetime.sessions;
  private readonly confirmed = new BrowserConfirmedSessionExecutor(
    (owner, signal, operation) => this.withSession(owner, signal, operation),
    (key, session, request, signal, upload) =>
      this.runOperation(key, session, request, true, signal, upload),
  );

  constructor(private readonly options: RunBrowserSessionManagerOptions) {}

  hasActiveSession(owner: BrowserSessionOwner): boolean {
    return this.sessions.get(browserSessionOwnerKey(owner))?.healthy === true;
  }

  hasWorkspacePreview(owner: BrowserSessionOwner): boolean {
    return (
      this.sessions.get(browserSessionOwnerKey(owner))
        ?.workspacePreviewActive === true
    );
  }

  async capturePage(
    owner: BrowserSessionOwner,
    maxChars: number,
    signal?: AbortSignal,
  ): Promise<BrowserPageSourceCapture> {
    const key = browserSessionOwnerKey(owner);
    return this.lifetime.serialized(
      key,
      async () => {
        assertBrowserSessionNotAborted(signal);
        const session = this.sessions.get(key);
        if (!session || !session.healthy) {
          throw new BrowserSessionInactiveError();
        }
        try {
          return await session.capturePage(maxChars, signal);
        } catch (error) {
          return await this.lifetime.fail(key, session, error);
        }
      },
      signal,
    );
  }

  async captureLiveView(
    owner: BrowserSessionOwner,
    signal?: AbortSignal,
  ): Promise<{ image: Buffer; receipt: BrowserLiveViewReceipt }> {
    const key = browserSessionOwnerKey(owner);
    return this.lifetime.serialized(
      key,
      async () => {
        assertBrowserSessionNotAborted(signal);
        const session = this.sessions.get(key);
        if (!session || !session.healthy) {
          throw new BrowserSessionInactiveError();
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
    const key = browserSessionOwnerKey(owner);
    return this.lifetime.serialized(
      key,
      async () => {
        assertBrowserSessionNotAborted(signal);
        const session = this.sessions.get(key);
        if (!session || !session.healthy) {
          throw new BrowserSessionInactiveError();
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
          return await this.lifetime.fail(key, session, error);
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
          | "download"
          | "save_screenshot"
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

  async executePreparedUpload(
    owner: BrowserSessionOwner,
    request: Extract<BrowserSessionRequest, { action: "upload" }>,
    upload: BrowserPreparedUpload,
    signal?: AbortSignal,
  ): Promise<BrowserSessionOperationResult> {
    assertBrowserPreparedUpload(upload);
    try {
      return await this.executeRequest(owner, request, signal, upload);
    } finally {
      upload.buffer.fill(0);
    }
  }

  async captureConfirmationPageState(
    owner: BrowserSessionOwner,
    request: Extract<
      BrowserSessionRequest,
      { action: "click" | "type" | "select" | "upload" | "download" }
    >,
    signal?: AbortSignal,
  ): Promise<BrowserConfirmationPageState> {
    return await this.confirmed.capture(owner, request, signal);
  }

  async executeConfirmedAction(
    owner: BrowserSessionOwner,
    request: Extract<
      BrowserSessionRequest,
      {
        action: "click" | "type" | "select" | "download";
      }
    >,
    expected: BrowserConfirmationPageState,
    signal?: AbortSignal,
  ): Promise<BrowserSessionOperationResult> {
    return await this.confirmed.execute(owner, request, expected, signal);
  }

  async executeConfirmedUpload(
    owner: BrowserSessionOwner,
    request: Extract<BrowserSessionRequest, { action: "upload" }>,
    upload: BrowserPreparedUpload,
    expected: BrowserConfirmationPageState,
    signal?: AbortSignal,
  ): Promise<BrowserSessionOperationResult> {
    return await this.confirmed.execute(
      owner,
      request,
      expected,
      signal,
      upload,
    );
  }

  private async executeRequest(
    owner: BrowserSessionOwner,
    request: BrowserSessionRequest,
    signal?: AbortSignal,
    preparedUpload?: BrowserPreparedUpload,
  ): Promise<BrowserSessionOperationResult> {
    const key = browserSessionOwnerKey(owner);
    return this.lifetime.serialized(
      key,
      async () => {
        assertBrowserSessionNotAborted(signal);
        if (
          request.action === "start" ||
          request.action === "preview_workspace"
        ) {
          const active = this.sessions.get(key);
          if (active?.healthy) {
            return await this.runOperation(key, active, request, true, signal);
          }
          if (active) {
            await this.lifetime.close(key, active);
          }
          await this.lifetime.prune();
          const startSignal = signal
            ? AbortSignal.any([signal, this.lifetime.shutdownController.signal])
            : this.lifetime.shutdownController.signal;
          const session = await this.lifetime.start(key, () => PersistentBrowserSession.start(
            this.options, owner, startSignal,
            request.action === "start"
              ? () => preflightBrowserStartUrl(owner, request.url, this.options)
              : undefined,
          ));
          try {
            return await this.runOperation(
              key,
              session,
              request,
              false,
              signal,
            );
          } catch (error) {
            if (session.healthy && isBrowserNavigationTimeout(request, error)) {
              throw error;
            }
            return await this.lifetime.fail(key, session, error);
          }
        }
        const session = this.sessions.get(key);
        if (!session || !session.healthy) {
          if (session) {
            await this.lifetime.close(key, session);
          }
          throw new BrowserSessionInactiveError();
        }
        return this.runOperation(
          key,
          session,
          request,
          true,
          signal,
          preparedUpload,
        );
      },
      signal,
    );
  }

  async cancelRun(owner: BrowserSessionOwner): Promise<void> {
    const key = browserSessionOwnerKey(owner);
    const keys = owner.sessionLane
      ? [key]
      : [...this.sessions.keys()].filter(
          (candidate) => candidate === key || candidate.startsWith(`${key}\0`),
        );
    const sessions = keys.flatMap((candidate): Array<[string, PersistentBrowserSession]> => {
      const session = this.sessions.get(candidate);
      return session ? [[candidate, session]] : [];
    });
    await this.lifetime.closeEntries(sessions);
  }

  shutdown(): Promise<void> {
    return this.lifetime.shutdown();
  }

  private async runOperation(
    key: string,
    session: PersistentBrowserSession,
    request: BrowserSessionRequest,
    reused: boolean,
    signal?: AbortSignal,
    preparedUpload?: BrowserPreparedUpload,
  ): Promise<BrowserSessionOperationResult> {
    try {
      const result = await session.execute(
        request,
        reused,
        signal,
        true,
        preparedUpload,
      );
      if (request.action === "close") {
        await this.lifetime.close(key, session);
      }
      return result;
    } catch (error) {
      if (
        error instanceof BrowserConfirmationPageChangedError ||
        error instanceof BrowserNavigationPolicyError ||
        (session.healthy &&
          (error instanceof BrowserTargetTimeoutError ||
            isBrowserNavigationTimeout(request, error)))
      ) {
        throw error;
      }
      return await this.lifetime.fail(key, session, error);
    }
  }

  private async withSession<T>(
    owner: BrowserSessionOwner,
    signal: AbortSignal | undefined,
    operation: (session: PersistentBrowserSession, key: string) => Promise<T>,
  ): Promise<T> {
    const key = browserSessionOwnerKey(owner);
    return await this.lifetime.serialized(
      key,
      async () => {
        assertBrowserSessionNotAborted(signal);
        const session = this.sessions.get(key);
        if (!session || !session.healthy) {
          throw new BrowserSessionInactiveError();
        }
        try {
          return await operation(session, key);
        } catch (error) {
          if (
            error instanceof BrowserConfirmationPageChangedError ||
            (session.healthy && error instanceof BrowserTargetTimeoutError)
          )
            throw error;
          return await this.lifetime.fail(key, session, error);
        }
      },
      signal,
    );
  }

}
