import {
  createBrowserConfirmationPageState,
  type BrowserConfirmationPageState,
} from "../src/browser-confirmed-action.js";
import type {
  BrowserSessionOwner,
  BrowserSessionRequest,
} from "../src/browser-session-model.js";
import type { BrowserPreparedUpload } from "../src/browser-workspace-files.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";

interface BrowserConfirmationSessionDouble {
  execute(
    owner: BrowserSessionOwner,
    request: BrowserSessionRequest,
    signal?: AbortSignal,
  ): Promise<unknown>;
  executePreparedUpload?(
    owner: BrowserSessionOwner,
    request: Extract<BrowserSessionRequest, { action: "upload" }>,
    upload: BrowserPreparedUpload,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

export function withBrowserConfirmationState<
  Session extends BrowserConfirmationSessionDouble,
>(session: Session): Session {
  const confirmed = session as Session & {
    captureConfirmationPageState: (
      owner: BrowserSessionOwner,
      request: BrowserSessionRequest,
      signal?: AbortSignal,
    ) => Promise<BrowserConfirmationPageState>;
    executeConfirmedAction: (
      owner: BrowserSessionOwner,
      request: BrowserSessionRequest,
      expected: BrowserConfirmationPageState,
      signal?: AbortSignal,
    ) => Promise<unknown>;
    executeConfirmedUpload: (
      owner: BrowserSessionOwner,
      request: Extract<BrowserSessionRequest, { action: "upload" }>,
      upload: BrowserPreparedUpload,
      expected: BrowserConfirmationPageState,
      signal?: AbortSignal,
    ) => Promise<unknown>;
  };
  confirmed.captureConfirmationPageState = async () =>
    browserConfirmationPageState();
  confirmed.executeConfirmedAction = async (
    owner,
    request,
    _expected,
    signal,
  ) => session.execute(owner, request, signal);
  confirmed.executeConfirmedUpload = async (
    owner,
    request,
    upload,
    _expected,
    signal,
  ) => {
    if (!session.executePreparedUpload) {
      throw new Error("Prepared upload test double is unavailable");
    }
    return session.executePreparedUpload(owner, request, upload, signal);
  };
  return session;
}

export function browserConfirmationPageState(): BrowserConfirmationPageState {
  return createBrowserConfirmationPageState({
    sessionIdSha256: "a".repeat(64),
    sessionOperation: 1,
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: sha256(canonicalJson(["tab_1"])),
    currentUrlSha256: "e".repeat(64),
    currentOriginSha256: "f".repeat(64),
    targetStateSha256: sha256("stable test target"),
    targetSensitivity: "ordinary",
    targetSensitivitySha256: sha256(canonicalJson([])),
  });
}
