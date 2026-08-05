export const BROWSER_TAKEOVER_KEYS = [
  "Tab",
  "Shift+Tab",
  "Enter",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
] as const;

export type BrowserTakeoverKey = (typeof BROWSER_TAKEOVER_KEYS)[number];

export type BrowserTakeoverAction =
  | "click"
  | "visual_click"
  | "keypress"
  | "type"
  | "select"
  | "scroll"
  | "back"
  | "forward"
  | "tab_new"
  | "tab_switch"
  | "tab_close"
  | "wait";

export interface BrowserTakeoverSnapshot {
  kind: "napier.browser-takeover-snapshot";
  schemaVersion: 2;
  threadId: string;
  runId: string;
  pauseStateSha256: string;
  sessionIdSha256: string;
  sessionOperation: number;
  activeTabId: string;
  tabCount: number;
  tabSetSha256: string;
  tabs: BrowserTakeoverTab[];
  snapshot: string;
  snapshotSha256: string;
  snapshotChars: number;
  snapshotTruncated: boolean;
  currentUrlSha256: string;
  currentOriginSha256: string;
  titleSha256: string;
  capturedAt: string;
  contentSha256: string;
}

export interface BrowserTakeoverTab {
  tabId: string;
  active: boolean;
  url: string;
  currentUrlSha256: string;
  title: string;
  titleSha256: string;
}

interface BrowserTakeoverActionBinding {
  expectedPauseStateSha256: string;
  expectedSessionIdSha256: string;
  expectedSessionOperation: number;
  expectedSnapshotSha256: string;
  expectedActiveTabId: string;
  expectedTabCount: number;
  expectedTabSetSha256: string;
}

interface BrowserTakeoverVisualBinding {
  expectedLiveImageSha256: string;
  expectedViewportWidth: number;
  expectedViewportHeight: number;
}

export type ExecuteBrowserTakeoverActionRequest =
  | (BrowserTakeoverActionBinding & {
      action: "click";
      ref: string;
      allowCrossOrigin?: boolean;
    })
  | (BrowserTakeoverActionBinding & {
      action: "type";
      ref: string;
      text: string;
    })
  | (BrowserTakeoverActionBinding & {
      action: "select";
      ref: string;
      values: string[];
    })
  | (BrowserTakeoverActionBinding & {
      action: "scroll";
      direction: "up" | "down";
      pixels?: number;
    })
  | (BrowserTakeoverActionBinding & {
      action: "back";
      allowCrossOrigin?: boolean;
    })
  | (BrowserTakeoverActionBinding & {
      action: "forward";
      allowCrossOrigin?: boolean;
    })
  | (BrowserTakeoverActionBinding & {
      action: "tab_new";
      url: string;
      allowCrossOrigin?: boolean;
    })
  | (BrowserTakeoverActionBinding & {
      action: "tab_switch";
      tabId: string;
    })
  | (BrowserTakeoverActionBinding & {
      action: "tab_close";
      tabId: string;
    })
  | (BrowserTakeoverActionBinding & {
      action: "wait";
      durationMs?: number;
    })
  | (BrowserTakeoverActionBinding &
      BrowserTakeoverVisualBinding & {
        action: "visual_click";
        x: number;
        y: number;
        allowCrossOrigin?: boolean;
      })
  | (BrowserTakeoverActionBinding & {
      action: "keypress";
      key: BrowserTakeoverKey;
      allowCrossOrigin?: boolean;
    });

export interface BrowserTakeoverActionReceipt {
  kind: "napier.browser-takeover-action";
  schemaVersion: 2;
  id: `browser_takeover_${string}`;
  threadId: string;
  runId: string;
  action: BrowserTakeoverAction;
  status: "requested" | "completed" | "failed";
  requestSha256: string;
  pauseStateSha256: string;
  sourceSessionIdSha256: string;
  sourceSessionOperation: number;
  sourceSnapshotSha256: string;
  sourceActiveTabId: string;
  sourceTabCount: number;
  sourceTabSetSha256: string;
  sourceLiveImageSha256?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  coordinateXSha256?: string;
  coordinateYSha256?: string;
  key?: BrowserTakeoverKey;
  targetTabIdSha256?: string;
  targetUrlSha256?: string;
  targetOriginSha256?: string;
  targetRefSha256?: string;
  textSha256?: string;
  textBytes?: number;
  valueSetSha256?: string;
  valueCount?: number;
  direction?: "up" | "down";
  pixels?: number;
  durationMs?: number;
  crossOriginAuthorized: boolean;
  requestedAt: string;
  settledAt?: string;
  sessionIdSha256?: string;
  sessionOperation?: number;
  activeTabId?: string;
  tabCount?: number;
  tabSetSha256?: string;
  currentUrlSha256?: string;
  currentOriginSha256?: string;
  titleSha256?: string;
  snapshotSha256?: string;
  snapshotChars?: number;
  snapshotTruncated?: boolean;
  failureCode?: "browser_action_failed";
  contentSha256: string;
}
