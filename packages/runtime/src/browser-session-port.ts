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
};
