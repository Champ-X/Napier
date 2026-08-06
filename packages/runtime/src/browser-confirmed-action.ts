import type { BrowserInteractionAction } from "@napier/contracts/browser-interaction-confirmation";

import type {
  BrowserSessionOwner,
  BrowserSessionRequest,
} from "./browser-session-model.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { toolInvocationArgumentsSha256 } from "./tool-invocation-capsule.js";

export const MAX_PREPARED_BROWSER_ACTIONS = 4;

export class BrowserConfirmationPageChangedError extends Error {
  constructor() {
    super(
      "Browser page changed while confirmation was pending; take a fresh snapshot and retry",
    );
    this.name = "BrowserConfirmationPageChangedError";
  }
}

export interface BrowserConfirmationPageState {
  kind: "napier.browser-confirmation-page-state";
  schemaVersion: 1;
  sessionIdSha256: string;
  sessionOperation: number;
  activeTabId: string;
  tabCount: number;
  tabSetSha256: string;
  currentUrlSha256: string;
  currentOriginSha256: string;
  targetStateSha256: string;
  contentSha256: string;
}

export interface BrowserConfirmedActionCandidate {
  owner: BrowserSessionOwner;
  callId: string;
  action: BrowserInteractionAction;
  argumentsSha256: string;
  pageState: BrowserConfirmationPageState;
}

export type BrowserConfirmedPageRequest = Extract<
  BrowserSessionRequest,
  { action: "click" | "type" | "select" | "upload" | "download" }
>;

export class BrowserConfirmedActionManager {
  private readonly prepared = new Map<
    string,
    BrowserConfirmedActionCandidate
  >();
  private readonly approved = new Map<
    string,
    BrowserConfirmedActionCandidate
  >();

  prepare(input: {
    owner: BrowserSessionOwner;
    callId: string;
    request: BrowserSessionRequest;
    pageState: BrowserConfirmationPageState;
  }): BrowserConfirmedActionCandidate {
    const action = confirmedAction(input.request.action);
    validateIdentity(input.owner, input.callId);
    validatePageState(input.pageState);
    const key = authorizationKey(input.owner, input.callId);
    if (
      this.prepared.has(key) ||
      this.approved.has(key) ||
      this.prepared.size + this.approved.size >= MAX_PREPARED_BROWSER_ACTIONS
    ) {
      throw new Error("Browser prepared action limit reached");
    }
    const candidate = {
      owner: structuredClone(input.owner),
      callId: input.callId,
      action,
      argumentsSha256: toolInvocationArgumentsSha256(input.request),
      pageState: structuredClone(input.pageState),
    };
    this.prepared.set(key, candidate);
    return candidate;
  }

  approve(candidate: BrowserConfirmedActionCandidate): void {
    validateCandidate(candidate);
    const key = authorizationKey(candidate.owner, candidate.callId);
    if (this.prepared.get(key) !== candidate || this.approved.has(key)) {
      throw new Error("Browser prepared action is unavailable");
    }
    this.prepared.delete(key);
    this.approved.set(key, candidate);
  }

  discard(candidate: BrowserConfirmedActionCandidate): void {
    const key = authorizationKey(candidate.owner, candidate.callId);
    if (this.prepared.get(key) === candidate) this.prepared.delete(key);
  }

  consume(input: {
    owner: BrowserSessionOwner;
    callId: string;
    request: BrowserSessionRequest;
  }): BrowserConfirmationPageState {
    validateIdentity(input.owner, input.callId);
    const key = authorizationKey(input.owner, input.callId);
    const candidate = this.approved.get(key);
    this.approved.delete(key);
    if (
      !candidate ||
      candidate.action !== input.request.action ||
      candidate.argumentsSha256 !== toolInvocationArgumentsSha256(input.request)
    ) {
      throw new Error("Browser action confirmation is unavailable");
    }
    return structuredClone(candidate.pageState);
  }

  cancelRun(owner: BrowserSessionOwner): void {
    const prefix = `${owner.threadId}\u0000${owner.runId}\u0000`;
    for (const candidates of [this.prepared, this.approved]) {
      for (const key of candidates.keys()) {
        if (key.startsWith(prefix)) candidates.delete(key);
      }
    }
  }
}

export function createBrowserConfirmationPageState(
  input: Omit<
    BrowserConfirmationPageState,
    "kind" | "schemaVersion" | "contentSha256"
  >,
): BrowserConfirmationPageState {
  const content = {
    kind: "napier.browser-confirmation-page-state" as const,
    schemaVersion: 1 as const,
    ...input,
  };
  const state = {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
  validatePageState(state);
  return state;
}

export function assertBrowserConfirmationPageStateCurrent(
  expected: BrowserConfirmationPageState,
  current: BrowserConfirmationPageState,
): void {
  validatePageState(expected);
  validatePageState(current);
  if (expected.contentSha256 !== current.contentSha256) {
    throw new BrowserConfirmationPageChangedError();
  }
}

function validateCandidate(candidate: BrowserConfirmedActionCandidate): void {
  validateIdentity(candidate.owner, candidate.callId);
  confirmedAction(candidate.action);
  if (!/^[a-f0-9]{64}$/u.test(candidate.argumentsSha256)) {
    throw new Error("Browser confirmed action is invalid");
  }
  validatePageState(candidate.pageState);
}

function validatePageState(state: BrowserConfirmationPageState): void {
  const { contentSha256, ...content } = state;
  if (
    state.kind !== "napier.browser-confirmation-page-state" ||
    state.schemaVersion !== 1 ||
    !Number.isSafeInteger(state.sessionOperation) ||
    state.sessionOperation < 0 ||
    !state.activeTabId ||
    !Number.isSafeInteger(state.tabCount) ||
    state.tabCount < 1 ||
    ![
      state.sessionIdSha256,
      state.tabSetSha256,
      state.currentUrlSha256,
      state.currentOriginSha256,
      state.targetStateSha256,
      contentSha256,
    ].every((value) => /^[a-f0-9]{64}$/u.test(value)) ||
    sha256(canonicalJson(content)) !== contentSha256
  ) {
    throw new Error("Browser confirmation page state is invalid");
  }
}

function confirmedAction(value: string): BrowserInteractionAction {
  if (
    value !== "click" &&
    value !== "type" &&
    value !== "select" &&
    value !== "upload" &&
    value !== "download"
  ) {
    throw new Error("Browser action does not use page-state confirmation");
  }
  return value;
}

function validateIdentity(owner: BrowserSessionOwner, callId: string): void {
  if (!owner.threadId || !owner.runId || !callId) {
    throw new Error("Browser confirmed action identity is invalid");
  }
}

function authorizationKey(owner: BrowserSessionOwner, callId: string): string {
  return `${owner.threadId}\u0000${owner.runId}\u0000${callId}`;
}
