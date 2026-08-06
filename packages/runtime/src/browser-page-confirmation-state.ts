import type { Locator, Page } from "playwright-core";

import {
  createBrowserConfirmationPageState,
  type BrowserConfirmationPageState,
} from "./browser-confirmed-action.js";
import {
  BROWSER_ACTION_TIMEOUT_MS,
  type BrowserElementTarget,
} from "./browser-session-model.js";
import { browserPageOrigin } from "./browser-session-navigation.js";
import type { BrowserSessionTabEvidence } from "./browser-session-tabs.js";
import { inspectBrowserSensitiveTarget } from "./browser-sensitive-target.js";
import { sha256 } from "./ed25519.js";

export const MAX_BROWSER_CONFIRMATION_TARGET_CHARS = 8_192;

export async function captureBrowserPageConfirmationState(input: {
  page: Page;
  target: BrowserElementTarget;
  action: "click" | "type" | "select" | "upload" | "download";
  locator: (page: Page, target: BrowserElementTarget) => Locator;
  sessionOperation: number;
  sessionIdSha256: string;
  tabs: BrowserSessionTabEvidence;
  signal?: AbortSignal;
}): Promise<BrowserConfirmationPageState> {
  const beforeUrl = input.page.url().slice(0, 4_096);
  const locator = input.locator(input.page, input.target);
  const [targetState, sensitivity] = await Promise.all([
    locator.ariaSnapshot({
      mode: "ai",
      depth: 6,
      timeout: BROWSER_ACTION_TIMEOUT_MS,
      ...(input.signal ? { signal: input.signal } : {}),
    }),
    inspectBrowserSensitiveTarget(locator, input.action, input.signal),
  ]);
  const afterUrl = input.page.url().slice(0, 4_096);
  if (
    beforeUrl !== afterUrl ||
    !targetState.trim() ||
    targetState.length > MAX_BROWSER_CONFIRMATION_TARGET_CHARS
  ) {
    throw new Error("Browser confirmation target state is unavailable");
  }
  return createBrowserConfirmationPageState({
    sessionIdSha256: input.sessionIdSha256,
    sessionOperation: input.sessionOperation,
    activeTabId: input.tabs.activeTabId,
    tabCount: input.tabs.tabCount,
    tabSetSha256: input.tabs.tabSetSha256,
    currentUrlSha256: sha256(beforeUrl),
    currentOriginSha256: sha256(browserPageOrigin(beforeUrl) ?? ""),
    targetStateSha256: sha256(targetState),
    targetSensitivity: sensitivity.status,
    targetSensitivitySha256: sensitivity.signalsSha256,
  });
}
