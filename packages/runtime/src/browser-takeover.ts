import type { JsonValue } from "@napier/contracts";
import type {
  BrowserTakeoverActionReceipt,
  BrowserTakeoverSnapshot,
  ExecuteBrowserTakeoverActionRequest,
} from "@napier/contracts/browser-takeover";

import type { AgentCapabilityRuntime } from "./agent-capability-runtime.js";
import {
  MAX_BROWSER_SCROLL_PIXELS,
  MAX_BROWSER_WAIT_MS,
} from "./browser-session-model.js";
import type { BrowserSessionPauseManager } from "./browser-session-pause.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId, nowIso } from "./ids.js";
import type { LocalStore } from "./store.js";

type BrowserTakeoverStore = Pick<
  LocalStore,
  "appendEvent" | "getThread" | "listRuns"
>;

type BrowserTakeoverCapabilities = Pick<
  AgentCapabilityRuntime,
  | "captureBrowserTakeoverSnapshot"
  | "executeBrowserTakeoverAction"
  | "hasActiveBrowserSession"
>;

export class BrowserTakeoverService {
  private readonly snapshots = new Map<string, BrowserTakeoverSnapshotBinding>();

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
      const captured =
        await this.capabilities.captureBrowserTakeoverSnapshot(owner, signal);
      const details = captured.details;
      const snapshotText = captured.snapshot;
      if (
        snapshotText === undefined ||
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
        schemaVersion: 1 as const,
        threadId,
        runId,
        pauseStateSha256: pause.contentSha256,
        sessionIdSha256: details.sessionIdSha256,
        sessionOperation: details.sessionOperation,
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
      this.remember(owner, snapshotBinding(snapshot));
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
    validateActionRequest(request);
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
          snapshot.snapshotSha256 !== request.expectedSnapshotSha256
        ) {
          throw new Error("Browser takeover snapshot changed");
        }
        const requested = createActionReceipt(owner, request, "requested");
        await this.append(requested);
        this.snapshots.delete(ownerKey(owner));
        let result: Awaited<
          ReturnType<
            BrowserTakeoverCapabilities["executeBrowserTakeoverAction"]
          >
        >;
        try {
          result = await this.capabilities.executeBrowserTakeoverAction(
            owner,
            request,
            signal,
          );
          validateActionResult(request, result.details);
        } catch {
          const failed = createActionReceipt(owner, request, "failed", {
            requested,
          });
          await this.append(failed).catch(() => undefined);
          throw new Error("Browser takeover action failed");
        }
        const completed = createActionReceipt(owner, request, "completed", {
          requested,
          details: result.details,
        });
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

interface BrowserTakeoverSnapshotBinding {
  pauseStateSha256: string;
  sessionIdSha256: string;
  sessionOperation: number;
  snapshotSha256: string;
}

function snapshotBinding(
  snapshot: BrowserTakeoverSnapshot,
): BrowserTakeoverSnapshotBinding {
  return {
    pauseStateSha256: snapshot.pauseStateSha256,
    sessionIdSha256: snapshot.sessionIdSha256,
    sessionOperation: snapshot.sessionOperation,
    snapshotSha256: snapshot.snapshotSha256,
  };
}

function createActionReceipt(
  owner: { threadId: string; runId: string },
  request: ExecuteBrowserTakeoverActionRequest,
  status: BrowserTakeoverActionReceipt["status"],
  options: {
    requested?: BrowserTakeoverActionReceipt;
    details?: Awaited<
      ReturnType<BrowserTakeoverCapabilities["executeBrowserTakeoverAction"]>
    >["details"];
  } = {},
): BrowserTakeoverActionReceipt {
  const requestedAt = options.requested?.requestedAt ?? nowIso();
  const content = {
    kind: "napier.browser-takeover-action" as const,
    schemaVersion: 1 as const,
    id:
      options.requested?.id ??
      (createId("browser_takeover") as `browser_takeover_${string}`),
    ...owner,
    action: request.action,
    status,
    requestSha256:
      options.requested?.requestSha256 ?? sha256(canonicalJson(request)),
    pauseStateSha256: request.expectedPauseStateSha256,
    sourceSessionIdSha256: request.expectedSessionIdSha256,
    sourceSessionOperation: request.expectedSessionOperation,
    sourceSnapshotSha256: request.expectedSnapshotSha256,
    ...actionEvidence(request),
    crossOriginAuthorized:
      "allowCrossOrigin" in request && request.allowCrossOrigin === true,
    requestedAt,
    ...(status === "requested" ? {} : { settledAt: nowIso() }),
    ...(options.details
      ? {
          sessionIdSha256: options.details.sessionIdSha256,
          sessionOperation: options.details.sessionOperation,
          currentUrlSha256: options.details.currentUrlSha256,
          currentOriginSha256: options.details.currentOriginSha256,
          titleSha256: options.details.titleSha256,
          ...(options.details.snapshotSha256
            ? {
                snapshotSha256: options.details.snapshotSha256,
                snapshotChars: options.details.snapshotChars,
                snapshotTruncated: options.details.snapshotTruncated,
              }
            : {}),
        }
      : {}),
    ...(status === "failed"
      ? { failureCode: "browser_action_failed" as const }
      : {}),
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

function actionEvidence(request: ExecuteBrowserTakeoverActionRequest) {
  if (request.action === "click") {
    return { targetRefSha256: sha256(request.ref) };
  }
  if (request.action === "type") {
    return {
      targetRefSha256: sha256(request.ref),
      textSha256: sha256(request.text),
      textBytes: Buffer.byteLength(request.text, "utf8"),
    };
  }
  if (request.action === "select") {
    return {
      targetRefSha256: sha256(request.ref),
      valueSetSha256: sha256(canonicalJson(request.values)),
      valueCount: request.values.length,
    };
  }
  if (request.action === "scroll") {
    return {
      direction: request.direction,
      ...(request.pixels !== undefined ? { pixels: request.pixels } : {}),
    };
  }
  if (request.action === "wait") {
    return {
      ...(request.durationMs !== undefined
        ? { durationMs: request.durationMs }
        : {}),
    };
  }
  return {};
}

function validateActionRequest(
  request: ExecuteBrowserTakeoverActionRequest,
): void {
  if (
    !isSha256(request.expectedPauseStateSha256) ||
    !isSha256(request.expectedSessionIdSha256) ||
    !isSha256(request.expectedSnapshotSha256) ||
    !Number.isSafeInteger(request.expectedSessionOperation) ||
    request.expectedSessionOperation < 0 ||
    !validAction(request)
  ) {
    throw new Error("Browser takeover request is invalid");
  }
}

function validateActionResult(
  request: ExecuteBrowserTakeoverActionRequest,
  details: Awaited<
    ReturnType<BrowserTakeoverCapabilities["executeBrowserTakeoverAction"]>
  >["details"],
): void {
  if (
    details.action !== request.action ||
    details.sessionIdSha256 !== request.expectedSessionIdSha256 ||
    details.sessionOperation !== request.expectedSessionOperation + 1
  ) {
    throw new Error("Browser takeover action evidence is invalid");
  }
}

function validAction(request: ExecuteBrowserTakeoverActionRequest): boolean {
  if (
    request.action === "click" ||
    request.action === "type" ||
    request.action === "select"
  ) {
    if (
      typeof request.ref !== "string" ||
      !/^[a-z0-9]{1,40}$/u.test(request.ref)
    ) {
      return false;
    }
  }
  if (request.action === "type") {
    return (
      typeof request.text === "string" &&
      Buffer.byteLength(request.text, "utf8") <= 8_000
    );
  }
  if (request.action === "select") {
    return (
      Array.isArray(request.values) &&
      request.values.length >= 1 &&
      request.values.length <= 20 &&
      request.values.every(
        (value) =>
          typeof value === "string" &&
          Buffer.byteLength(value, "utf8") <= 512,
      )
    );
  }
  if (request.action === "scroll") {
    return (
      (request.direction === "up" || request.direction === "down") &&
      (request.pixels === undefined ||
        (Number.isSafeInteger(request.pixels) &&
          request.pixels >= 1 &&
          request.pixels <= MAX_BROWSER_SCROLL_PIXELS))
    );
  }
  if (request.action === "wait") {
    return (
      request.durationMs === undefined ||
      (Number.isSafeInteger(request.durationMs) &&
        request.durationMs >= 1 &&
        request.durationMs <= MAX_BROWSER_WAIT_MS)
    );
  }
  return true;
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function ownerKey(owner: { threadId: string; runId: string }): string {
  return `${owner.threadId}\u0000${owner.runId}`;
}
