export type BrowserTakeoverAction =
  | "click"
  | "type"
  | "select"
  | "scroll"
  | "back"
  | "wait";

export interface BrowserTakeoverSnapshot {
  kind: "napier.browser-takeover-snapshot";
  schemaVersion: 1;
  threadId: string;
  runId: string;
  pauseStateSha256: string;
  sessionIdSha256: string;
  sessionOperation: number;
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

interface BrowserTakeoverActionBinding {
  expectedPauseStateSha256: string;
  expectedSessionIdSha256: string;
  expectedSessionOperation: number;
  expectedSnapshotSha256: string;
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
      action: "wait";
      durationMs?: number;
    });

export interface BrowserTakeoverActionReceipt {
  kind: "napier.browser-takeover-action";
  schemaVersion: 1;
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
  currentUrlSha256?: string;
  currentOriginSha256?: string;
  titleSha256?: string;
  snapshotSha256?: string;
  snapshotChars?: number;
  snapshotTruncated?: boolean;
  failureCode?: "browser_action_failed";
  contentSha256: string;
}
