import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import {
  BROWSER_TAKEOVER_KEYS,
  type ExecuteBrowserTakeoverActionRequest,
} from "@napier/contracts/browser-takeover";

import {
  BROWSER_VIEWPORT_HEIGHT,
  BROWSER_VIEWPORT_WIDTH,
} from "./browser-session-model.js";
import { sha256 } from "./ed25519.js";

type VisualClickRequest = Extract<
  ExecuteBrowserTakeoverActionRequest,
  { action: "visual_click" }
>;

type KeypressRequest = Extract<
  ExecuteBrowserTakeoverActionRequest,
  { action: "keypress" }
>;

export function isBrowserVisualClickRequest(
  request: ExecuteBrowserTakeoverActionRequest,
): request is VisualClickRequest {
  return request.action === "visual_click";
}

export function validBrowserVisualClickRequest(
  request: VisualClickRequest,
): boolean {
  return (
    /^[a-f0-9]{64}$/u.test(request.expectedLiveImageSha256) &&
    request.expectedViewportWidth === BROWSER_VIEWPORT_WIDTH &&
    request.expectedViewportHeight === BROWSER_VIEWPORT_HEIGHT &&
    Number.isSafeInteger(request.x) &&
    request.x >= 0 &&
    request.x < BROWSER_VIEWPORT_WIDTH &&
    Number.isSafeInteger(request.y) &&
    request.y >= 0 &&
    request.y < BROWSER_VIEWPORT_HEIGHT
  );
}

export function validBrowserTakeoverKeypress(
  request: KeypressRequest,
): boolean {
  return BROWSER_TAKEOVER_KEYS.includes(request.key);
}

export function validBrowserVisualTakeoverAction(
  request: ExecuteBrowserTakeoverActionRequest,
): boolean | undefined {
  if (request.action === "visual_click") {
    return validBrowserVisualClickRequest(request);
  }
  if (request.action === "keypress") {
    return validBrowserTakeoverKeypress(request);
  }
  return undefined;
}

export function browserVisualActionEvidence(
  request: ExecuteBrowserTakeoverActionRequest,
):
  | {
      sourceLiveImageSha256: string;
      viewportWidth: number;
      viewportHeight: number;
      coordinateXSha256: string;
      coordinateYSha256: string;
    }
  | { key: KeypressRequest["key"] }
  | undefined {
  if (request.action === "visual_click") {
    return {
      sourceLiveImageSha256: request.expectedLiveImageSha256,
      viewportWidth: request.expectedViewportWidth,
      viewportHeight: request.expectedViewportHeight,
      coordinateXSha256: sha256(String(request.x)),
      coordinateYSha256: sha256(String(request.y)),
    };
  }
  return request.action === "keypress" ? { key: request.key } : undefined;
}

export function validateBrowserVisualClickBinding(
  request: VisualClickRequest,
  live: BrowserLiveViewReceipt,
): void {
  if (
    live.sessionIdSha256 !== request.expectedSessionIdSha256 ||
    live.sessionOperation !== request.expectedSessionOperation ||
    live.activeTabId !== request.expectedActiveTabId ||
    live.tabCount !== request.expectedTabCount ||
    live.tabSetSha256 !== request.expectedTabSetSha256 ||
    live.imageSha256 !== request.expectedLiveImageSha256 ||
    live.viewportWidth !== request.expectedViewportWidth ||
    live.viewportHeight !== request.expectedViewportHeight
  ) {
    throw new Error("Browser takeover live viewport changed");
  }
}
