export const BROWSER_LIVE_VIEWPORT_WIDTH = 1280;
export const BROWSER_LIVE_VIEWPORT_HEIGHT = 900;

export const BROWSER_PAGE_DIAGNOSIS_STATUSES = [
  "none",
  "login_required",
  "challenge_detected",
] as const;

export type BrowserPageDiagnosisStatus =
  (typeof BROWSER_PAGE_DIAGNOSIS_STATUSES)[number];

export interface BrowserPageDiagnosisEvidence {
  status: BrowserPageDiagnosisStatus;
  signalCount: number;
  signalsSha256: string;
  takeoverRecommended: boolean;
}

export interface BrowserLiveViewReceipt {
  kind: "napier.browser-live-view";
  schemaVersion: 4;
  threadId: string;
  runId: string;
  sessionIdSha256: string;
  sessionOperation: number;
  activeTabId: string;
  tabCount: number;
  tabSetSha256: string;
  imageSha256: string;
  imageBytes: number;
  mimeType: "image/png";
  viewportWidth: number;
  viewportHeight: number;
  capturedAt: string;
  currentUrlSha256: string;
  currentOriginSha256: string;
  titleSha256: string;
  browserExecutableSha256: string;
  browserVersionSha256: string;
  limitsSha256: string;
  networkRequestCount: number;
  blockedRequestCount: number;
  pageDiagnosis: BrowserPageDiagnosisEvidence;
  contentSha256: string;
}
