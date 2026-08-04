export interface BrowserSessionPauseState {
  kind: "napier.browser-session-pause-state";
  schemaVersion: 1;
  threadId: string;
  runId: string;
  status: "running" | "paused" | "cancelled";
  pauseRequestedAt?: string;
  resumedAt?: string;
  cancelledAt?: string;
  contentSha256: string;
}

export interface ResumeBrowserSessionRequest {
  expectedPauseStateSha256: string;
}
