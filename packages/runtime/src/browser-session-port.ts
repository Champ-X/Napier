import type { RunBrowserSessionManager } from "./browser-session.js";

export type BrowserSessionPort = Pick<
  RunBrowserSessionManager,
  | "hasActiveSession"
  | "capturePage"
  | "captureLiveView"
  | "captureTakeoverSnapshot"
  | "executeTakeoverAction"
  | "execute"
  | "executeConfirmedUpload"
  | "executeConfirmedAction"
  | "captureConfirmationPageState"
  | "cancelRun"
> & {
  available?(): boolean;
  hasWorkspacePreview?(
    owner: Parameters<RunBrowserSessionManager["hasWorkspacePreview"]>[0],
  ): boolean;
};
