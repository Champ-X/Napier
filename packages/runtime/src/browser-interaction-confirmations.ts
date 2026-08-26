import {
  BROWSER_INTERACTION_ACTIONS,
  type BrowserInteractionAction,
  type BrowserInteractionConfirmation,
  type BrowserInteractionConfirmationStatus,
  type DecideBrowserInteractionConfirmationRequest,
} from "@napier/contracts/browser-interaction-confirmation";
import type { JsonObject } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import { createId, nowIso } from "./ids.js";
import type { LocalStore } from "./store.js";
import { BrowserConfirmedActionManager } from "./browser-confirmed-action.js";
import { BrowserUploadAuthorizationManager } from "./browser-upload-authorization.js";

export const BROWSER_INTERACTION_CONFIRMATION_TIMEOUT_MS = 60_000;

export interface BrowserInteractionConfirmationOwner {
  threadId: string;
  runId: string;
}

export interface BrowserInteractionConfirmationRequest extends BrowserInteractionConfirmationOwner {
  callId: string;
  action: BrowserInteractionAction;
  argumentsSha256: string;
  preview: BrowserInteractionConfirmation["preview"];
}

export interface BrowserInteractionConfirmationDecision {
  confirmation: BrowserInteractionConfirmation;
  decision: "approve" | "reject";
}

interface PendingConfirmation {
  confirmation: BrowserInteractionConfirmation;
  resolve: (decision: BrowserInteractionConfirmationDecision) => void;
  timeout: NodeJS.Timeout;
  signal?: AbortSignal;
  abortListener?: () => void;
  onEvent?: EventSink;
  settling: boolean;
}

export class BrowserInteractionConfirmationManager {
  private readonly pendingById = new Map<string, PendingConfirmation>();
  private readonly pendingByRun = new Map<string, string>();
  readonly actions = new BrowserConfirmedActionManager();
  readonly uploads: BrowserUploadAuthorizationManager;
  readonly available: boolean;

  constructor(
    private readonly store: Pick<LocalStore, "appendEvent" | "workspaceRoot">,
    options: { available?: boolean; timeoutMs?: number } = {},
  ) {
    this.uploads = new BrowserUploadAuthorizationManager(store.workspaceRoot);
    this.available = options.available === true;
    this.timeoutMs =
      options.timeoutMs ?? BROWSER_INTERACTION_CONFIRMATION_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > BROWSER_INTERACTION_CONFIRMATION_TIMEOUT_MS
    ) {
      throw new Error("Browser interaction confirmation timeout is invalid");
    }
  }

  private readonly timeoutMs: number;

  async request(
    input: BrowserInteractionConfirmationRequest,
    signal?: AbortSignal,
    onEvent?: EventSink,
  ): Promise<BrowserInteractionConfirmationDecision> {
    if (!this.available) {
      throw new Error(
        "Browser interaction confirmation is unavailable in this entry point",
      );
    }
    validateRequest(input);
    if (signal?.aborted) {
      throw new Error("Browser interaction confirmation was cancelled");
    }
    const runKey = ownerKey(input);
    if (this.pendingByRun.has(runKey)) {
      throw new Error(
        "This Run already has a pending Browser interaction confirmation",
      );
    }
    const requestedAt = nowIso();
    const expiresAt = new Date(
      Date.parse(requestedAt) + this.timeoutMs,
    ).toISOString();
    const confirmation = createConfirmation({
      id: createId("browser_confirm") as `browser_confirm_${string}`,
      threadId: input.threadId,
      runId: input.runId,
      callId: input.callId,
      action: input.action,
      argumentsSha256: input.argumentsSha256,
      preview: structuredClone(input.preview),
      status: "pending",
      requestedAt,
      expiresAt,
    });
    const decision = new Promise<BrowserInteractionConfirmationDecision>(
      (resolve) => {
        const timeout = setTimeout(() => {
          void this.settle(confirmation.id, "expired").catch(() => undefined);
        }, this.timeoutMs);
        const abortListener = signal
          ? () =>
              void this.settle(confirmation.id, "cancelled").catch(
                () => undefined,
              )
          : undefined;
        if (abortListener) {
          signal!.addEventListener("abort", abortListener, { once: true });
        }
        this.pendingByRun.set(runKey, confirmation.id);
        this.pendingById.set(confirmation.id, {
          confirmation,
          resolve,
          timeout,
          ...(signal ? { signal } : {}),
          ...(abortListener ? { abortListener } : {}),
          ...(onEvent ? { onEvent } : {}),
          settling: false,
        });
      },
    );
    try {
      await this.appendConfirmationEvent(confirmation, onEvent);
    } catch (error) {
      await this.settle(confirmation.id, "cancelled", false);
      throw error;
    }
    return decision;
  }

  list(
    owner: BrowserInteractionConfirmationOwner,
  ): BrowserInteractionConfirmation[] {
    const confirmationId = this.pendingByRun.get(ownerKey(owner));
    if (!confirmationId) return [];
    const pending = this.pendingById.get(confirmationId);
    return pending ? [structuredClone(pending.confirmation)] : [];
  }

  async decide(
    owner: BrowserInteractionConfirmationOwner,
    confirmationId: string,
    request: DecideBrowserInteractionConfirmationRequest,
  ): Promise<BrowserInteractionConfirmation> {
    const pending = this.pendingById.get(confirmationId);
    if (
      !pending ||
      pending.confirmation.threadId !== owner.threadId ||
      pending.confirmation.runId !== owner.runId
    ) {
      throw new Error(
        `Browser interaction confirmation not found: ${confirmationId}`,
      );
    }
    if (request.expectedRequestSha256 !== pending.confirmation.requestSha256) {
      throw new Error("Browser interaction confirmation request changed");
    }
    const status = request.decision === "approve" ? "approved" : "rejected";
    return (await this.settle(confirmationId, status)).confirmation;
  }

  async cancelRun(owner: BrowserInteractionConfirmationOwner): Promise<void> {
    this.actions.cancelRun(owner);
    this.uploads.cancelRun(owner);
    const confirmationId = this.pendingByRun.get(ownerKey(owner));
    if (!confirmationId) return;
    await this.settle(confirmationId, "cancelled").catch(() => undefined);
  }

  private async settle(
    confirmationId: string,
    status: Exclude<BrowserInteractionConfirmationStatus, "pending">,
    recordEvent = true,
  ): Promise<BrowserInteractionConfirmationDecision> {
    const pending = this.pendingById.get(confirmationId);
    if (!pending) {
      throw new Error(
        `Browser interaction confirmation not found: ${confirmationId}`,
      );
    }
    if (pending.settling) {
      throw new Error("Browser interaction confirmation is already settling");
    }
    pending.settling = true;
    const decision = status === "approved" ? "approve" : "reject";
    const decidedAt = nowIso();
    const {
      kind: _kind,
      schemaVersion: _schemaVersion,
      contentSha256: _contentSha256,
      ...confirmationBase
    } = pending.confirmation;
    const confirmation = createConfirmation({
      ...confirmationBase,
      status,
      decidedAt,
      decisionSha256: sha256(
        canonicalJson({
          confirmationId,
          status,
          requestSha256: pending.confirmation.requestSha256,
          decidedAt,
        }),
      ),
    });
    if (recordEvent) {
      try {
        await this.appendConfirmationEvent(confirmation, pending.onEvent);
      } catch (error) {
        pending.settling = false;
        throw error;
      }
    }
    this.pendingById.delete(confirmationId);
    this.pendingByRun.delete(ownerKey(pending.confirmation));
    clearTimeout(pending.timeout);
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
    const result = {
      confirmation,
      decision,
    } satisfies BrowserInteractionConfirmationDecision;
    pending.resolve(result);
    return result;
  }

  private async appendConfirmationEvent(
    confirmation: BrowserInteractionConfirmation,
    onEvent?: EventSink,
  ): Promise<void> {
    const event = await this.store.appendEvent({
      threadId: confirmation.threadId,
      runId: confirmation.runId,
      type: `browser.interaction_confirmation.${confirmation.status}`,
      category: "tool",
      visibility: "user",
      payload: JSON.parse(JSON.stringify(confirmation)) as JsonObject,
    });
    try {
      await onEvent?.(event);
    } catch {
      // Durable confirmation evidence survives a disconnected observer.
    }
  }
}

export function isBrowserInteractionAction(
  value: unknown,
): value is BrowserInteractionAction {
  return BROWSER_INTERACTION_ACTIONS.includes(
    value as BrowserInteractionAction,
  );
}

function createConfirmation(
  input: Omit<
    BrowserInteractionConfirmation,
    "kind" | "schemaVersion" | "requestSha256" | "contentSha256"
  > & {
    requestSha256?: string;
  },
): BrowserInteractionConfirmation {
  const requestContent = {
    kind: "napier.browser-interaction-confirmation-request" as const,
    schemaVersion: 1 as const,
    id: input.id,
    threadId: input.threadId,
    runId: input.runId,
    callId: input.callId,
    action: input.action,
    argumentsSha256: input.argumentsSha256,
    preview: input.preview,
    requestedAt: input.requestedAt,
    expiresAt: input.expiresAt,
  };
  const content = {
    kind: "napier.browser-interaction-confirmation" as const,
    schemaVersion: 1 as const,
    ...input,
    requestSha256: input.requestSha256 ?? sha256(canonicalJson(requestContent)),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function validateRequest(input: BrowserInteractionConfirmationRequest): void {
  if (
    !input.threadId ||
    !input.runId ||
    !input.callId ||
    !isBrowserInteractionAction(input.action) ||
    !/^[a-f0-9]{64}$/u.test(input.argumentsSha256) ||
    !validPreview(input.preview)
  ) {
    throw new Error("Browser interaction confirmation request is invalid");
  }
}

function validPreview(
  preview: BrowserInteractionConfirmation["preview"],
): boolean {
  const hashes = [
    preview.targetSha256,
    preview.textSha256,
    preview.valueSetSha256,
    preview.pathSha256,
    preview.fileSha256,
    preview.pageStateSha256,
    preview.sourceImageSha256,
  ];
  return (
    typeof preview.crossOriginAuthorized === "boolean" &&
    ((preview.targetKind === undefined && preview.targetSha256 === undefined) ||
      ((preview.targetKind === "ref" || preview.targetKind === "selector") &&
        preview.targetSha256 !== undefined)) &&
    hashes.every(
      (hash) => hash === undefined || /^[a-f0-9]{64}$/u.test(hash),
    ) &&
    (preview.fileSha256 === undefined) === (preview.fileBytes === undefined) &&
    validOptionalCount(preview.textBytes) &&
    validOptionalCount(preview.valueCount) &&
    validOptionalCount(preview.fileBytes)
  );
}

function validOptionalCount(value: number | undefined): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value >= 0);
}

function ownerKey(owner: BrowserInteractionConfirmationOwner): string {
  if (!owner.threadId || !owner.runId) {
    throw new Error("Browser interaction confirmation owner is invalid");
  }
  return `${owner.threadId}\u0000${owner.runId}`;
}
