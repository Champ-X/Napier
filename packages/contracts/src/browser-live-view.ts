export interface BrowserLiveViewReceipt {
  kind: "napier.browser-live-view";
  schemaVersion: 1;
  threadId: string;
  runId: string;
  sessionIdSha256: string;
  sessionOperation: number;
  imageSha256: string;
  imageBytes: number;
  mimeType: "image/png";
  capturedAt: string;
  currentUrlSha256: string;
  currentOriginSha256: string;
  titleSha256: string;
  browserExecutableSha256: string;
  browserVersionSha256: string;
  limitsSha256: string;
  networkRequestCount: number;
  blockedRequestCount: number;
  contentSha256: string;
}
