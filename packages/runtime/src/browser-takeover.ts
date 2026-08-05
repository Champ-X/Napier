import type { JsonValue } from "@napier/contracts";
import {
  type BrowserTakeoverActionReceipt,
  type BrowserTakeoverSnapshot,
  type ExecuteBrowserTakeoverActionRequest,
} from "@napier/contracts/browser-takeover";

import type { AgentCapabilityRuntime } from "./agent-capability-runtime.js";
import type { BrowserSessionPauseManager } from "./browser-session-pause.js";
import {
  browserTakeoverSnapshotBinding,
  createBrowserTakeoverActionReceipt,
  type BrowserTakeoverSnapshotBinding,
  validateBrowserTakeoverActionRequest,
  validateBrowserTakeoverActionResult,
} from "./browser-takeover-action.js";
import {
  isBrowserSaveScreenshotRequest,
  isBrowserVisualClickRequest,
  validateBrowserVisualClickBinding,
} from "./browser-takeover-visual.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { nowIso } from "./ids.js";
import type { LocalStore } from "./store.js";

type BrowserTakeoverStore = Pick<
  LocalStore,
  "appendEvent" | "getThread" | "listRuns"
>;

type BrowserTakeoverCapabilities = Pick<
  AgentCapabilityRuntime,
  | "captureBrowserTakeoverSnapshot"
  | "captureBrowserLiveView"
  | "executeBrowserTakeoverAction"
  | "hasActiveBrowserSession"
>;

export class BrowserTakeoverService {
  private readonly snapshots = new Map<
    string,
    BrowserTakeoverSnapshotBinding
  >();

  constructor(
    private readonly store: BrowserTakeoverStore,
    private readonly capabilities: BrowserTakeoverCapabilities,
    private readonly pauses: BrowserSessionPauseManager,
  ) {}

  clear(threadId: string, runId: string): void {
    this.snapshots.delete(ownerKey({ threadId, runId }));
  }

  async snapshot(
    threadId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<BrowserTakeoverSnapshot> {
    const owner = this.authorize(threadId, runId);
    return this.pauses.runWhilePaused(owner, undefined, async (pause) => {
      const captured = await this.capabilities.captureBrowserTakeoverSnapshot(
        owner,
        signal,
      );
      const details = captured.snapshot.details;
      const snapshotText = captured.snapshot.snapshot;
      const tabs = captured.tabs.tabs;
      if (
        snapshotText === undefined ||
        tabs === undefined ||
        tabs.length !== details.tabCount ||
        tabs.filter((tab) => tab.active).length !== 1 ||
        tabs.find((tab) => tab.active)?.tabId !== details.activeTabId ||
        sha256(canonicalJson(tabs.map((tab) => tab.tabId))) !==
          details.tabSetSha256 ||
        details.snapshotSha256 === undefined ||
        details.snapshotChars === undefined ||
        details.snapshotTruncated === undefined ||
        details.snapshotSha256 !== sha256(snapshotText) ||
        details.snapshotChars !== snapshotText.length
      ) {
        throw new Error("Browser takeover snapshot evidence is invalid");
      }
      const content = {
        kind: "napier.browser-takeover-snapshot" as const,
        schemaVersion: 2 as const,
        threadId,
        runId,
        pauseStateSha256: pause.contentSha256,
        sessionIdSha256: details.sessionIdSha256,
        sessionOperation: details.sessionOperation,
        activeTabId: details.activeTabId,
        tabCount: details.tabCount,
        tabSetSha256: details.tabSetSha256,
        tabs: tabs.map((tab) => ({
          tabId: tab.tabId,
          active: tab.active,
          url: tab.url,
          currentUrlSha256: sha256(tab.url),
          title: tab.title,
          titleSha256: sha256(tab.title),
        })),
        snapshot: snapshotText,
        snapshotSha256: details.snapshotSha256,
        snapshotChars: details.snapshotChars,
        snapshotTruncated: details.snapshotTruncated,
        currentUrlSha256: details.currentUrlSha256,
        currentOriginSha256: details.currentOriginSha256,
        titleSha256: details.titleSha256,
        capturedAt: nowIso(),
      };
      const snapshot = {
        ...content,
        contentSha256: sha256(canonicalJson(content)),
      };
      this.remember(owner, browserTakeoverSnapshotBinding(snapshot));
      return structuredClone(snapshot);
    });
  }

  async execute(
    threadId: string,
    runId: string,
    request: ExecuteBrowserTakeoverActionRequest,
    signal?: AbortSignal,
  ): Promise<BrowserTakeoverActionReceipt> {
    const owner = this.authorize(threadId, runId);
    validateBrowserTakeoverActionRequest(request);
    return this.pauses.runWhilePaused(
      owner,
      request.expectedPauseStateSha256,
      async () => {
        const snapshot = this.snapshots.get(ownerKey(owner));
        if (
          !snapshot ||
          snapshot.pauseStateSha256 !== request.expectedPauseStateSha256 ||
          snapshot.sessionIdSha256 !== request.expectedSessionIdSha256 ||
          snapshot.sessionOperation !== request.expectedSessionOperation ||
          snapshot.snapshotSha256 !== request.expectedSnapshotSha256 ||
          snapshot.activeTabIdSha256 !== sha256(request.expectedActiveTabId) ||
          snapshot.tabCount !== request.expectedTabCount ||
          snapshot.tabSetSha256 !== request.expectedTabSetSha256
        ) {
          throw new Error("Browser takeover snapshot changed");
        }
        const requested = createBrowserTakeoverActionReceipt(
          owner,
          request,
          "requested",
        );
        await this.append(requested);
        this.snapshots.delete(ownerKey(owner));
        let result: Awaited<
          ReturnType<
            BrowserTakeoverCapabilities["executeBrowserTakeoverAction"]
          >
        >;
        try {
          if (isBrowserVisualClickRequest(request)) {
            const live = await this.capabilities.captureBrowserLiveView(
              owner,
              signal,
            );
            validateBrowserVisualClickBinding(request, live.receipt);
          }
          if (isBrowserSaveScreenshotRequest(request)) {
            const live = await this.capabilities.captureBrowserLiveView(
              owner,
              signal,
            );
            validateBrowserVisualClickBinding(request, live.receipt);
          }
          result = await this.capabilities.executeBrowserTakeoverAction(
            owner,
            request,
            signal,
          );
          validateBrowserTakeoverActionResult(
            request,
            result.details,
            snapshot,
          );
        } catch {
          const failed = createBrowserTakeoverActionReceipt(
            owner,
            request,
            "failed",
            { requested },
          );
          await this.append(failed).catch(() => undefined);
          throw new Error("Browser takeover action failed");
        }
        const completed = createBrowserTakeoverActionReceipt(
          owner,
          request,
          "completed",
          {
            requested,
            details: result.details,
          },
        );
        await this.append(completed);
        return completed;
      },
    );
  }

  private remember(
    owner: { threadId: string; runId: string },
    snapshot: BrowserTakeoverSnapshotBinding,
  ): void {
    const key = ownerKey(owner);
    this.snapshots.delete(key);
    this.snapshots.set(key, snapshot);
    while (this.snapshots.size > 8) {
      const oldest = this.snapshots.keys().next().value as string | undefined;
      if (!oldest) break;
      this.snapshots.delete(oldest);
    }
  }

  private authorize(threadId: string, runId: string) {
    const thread = this.store.getThread(threadId);
    const run = this.store
      .listRuns(threadId)
      .find((candidate) => candidate.id === runId);
    if (
      !run ||
      run.source !== "user" ||
      run.status !== "running" ||
      thread.currentRunId !== run.id
    ) {
      throw new Error("Browser takeover requires the active user Run");
    }
    const owner = { threadId, runId };
    if (!this.capabilities.hasActiveBrowserSession(owner)) {
      throw new Error("Browser Session is not active for this Run");
    }
    return owner;
  }

  private async append(receipt: BrowserTakeoverActionReceipt): Promise<void> {
    await this.store.appendEvent({
      threadId: receipt.threadId,
      runId: receipt.runId,
      type: `browser.takeover.${receipt.status}`,
      category: "tool",
      visibility: "user",
      payload: JSON.parse(JSON.stringify(receipt)) as JsonValue,
    });
  }
}

function ownerKey(owner: { threadId: string; runId: string }): string {
  return `${owner.threadId}\u0000${owner.runId}`;
}
