import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import type { BrowserTakeoverSnapshot } from "@napier/contracts/browser-takeover";

export interface BrowserViewportBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function browserTakeoverLiveMatchesSnapshot(
  live: BrowserLiveViewReceipt,
  snapshot: BrowserTakeoverSnapshot,
): boolean {
  return (
    live.sessionIdSha256 === snapshot.sessionIdSha256 &&
    live.sessionOperation === snapshot.sessionOperation &&
    live.activeTabId === snapshot.activeTabId &&
    live.tabCount === snapshot.tabCount &&
    live.tabSetSha256 === snapshot.tabSetSha256 &&
    live.currentUrlSha256 === snapshot.currentUrlSha256 &&
    live.currentOriginSha256 === snapshot.currentOriginSha256 &&
    live.titleSha256 === snapshot.titleSha256
  );
}

export function browserViewportCoordinates(
  clientX: number,
  clientY: number,
  bounds: BrowserViewportBounds,
  receipt: Pick<BrowserLiveViewReceipt, "viewportWidth" | "viewportHeight">,
): { x: number; y: number } | undefined {
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    !Number.isFinite(bounds.left) ||
    !Number.isFinite(bounds.top) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    clientX < bounds.left ||
    clientX >= bounds.left + bounds.width ||
    clientY < bounds.top ||
    clientY >= bounds.top + bounds.height
  ) {
    return undefined;
  }
  return {
    x: boundedCoordinate(
      clientX,
      bounds.left,
      bounds.width,
      receipt.viewportWidth,
    ),
    y: boundedCoordinate(
      clientY,
      bounds.top,
      bounds.height,
      receipt.viewportHeight,
    ),
  };
}

function boundedCoordinate(
  pointer: number,
  start: number,
  renderedSize: number,
  viewportSize: number,
): number {
  return Math.min(
    viewportSize - 1,
    Math.floor(((pointer - start) / renderedSize) * viewportSize),
  );
}
