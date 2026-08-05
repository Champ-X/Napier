import type { ExecuteBrowserTakeoverActionRequest } from "@napier/contracts/browser-takeover";

import type { BrowserSessionDetails } from "./browser-session-model.js";
import { sha256 } from "./ed25519.js";

export interface BrowserTakeoverTabBinding {
  activeTabId: string;
  tabCount: number;
  tabSetSha256: string;
  tabIdSha256s: string[];
}

export function validateBrowserTakeoverTabResult(
  request: ExecuteBrowserTakeoverActionRequest,
  details: BrowserSessionDetails,
  snapshot: BrowserTakeoverTabBinding,
): void {
  if (
    request.action === "tab_new" &&
    (details.tabCount !== snapshot.tabCount + 1 ||
      details.tabSetSha256 === snapshot.tabSetSha256 ||
      snapshot.tabIdSha256s.includes(sha256(details.activeTabId)))
  ) {
    throw new Error("Browser takeover new tab evidence is invalid");
  }
  if (
    request.action === "tab_switch" &&
    (!snapshot.tabIdSha256s.includes(sha256(request.tabId)) ||
      details.tabCount !== snapshot.tabCount ||
      details.tabSetSha256 !== snapshot.tabSetSha256 ||
      details.activeTabId !== request.tabId)
  ) {
    throw new Error("Browser takeover tab switch evidence is invalid");
  }
  if (
    request.action === "tab_close" &&
    (!snapshot.tabIdSha256s.includes(sha256(request.tabId)) ||
      details.tabCount !== snapshot.tabCount - 1 ||
      details.tabSetSha256 === snapshot.tabSetSha256 ||
      details.activeTabId === request.tabId ||
      (request.tabId !== snapshot.activeTabId &&
        details.activeTabId !== snapshot.activeTabId))
  ) {
    throw new Error("Browser takeover tab close evidence is invalid");
  }
  if (
    request.action !== "tab_new" &&
    request.action !== "tab_switch" &&
    request.action !== "tab_close" &&
    (details.tabCount !== snapshot.tabCount ||
      details.tabSetSha256 !== snapshot.tabSetSha256 ||
      details.activeTabId !== snapshot.activeTabId)
  ) {
    throw new Error("Browser takeover active tab changed");
  }
}
