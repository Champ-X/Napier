import type { Page } from "playwright-core";

import type { BrowserConsoleRecorder } from "./browser-console-observation.js";
import { createBrowserSessionDetails } from "./browser-session-details.js";
import type {
  BrowserNetworkProxy,
  BrowserSessionOperationResult,
} from "./browser-session-model.js";
import { captureBrowserPageMetadata } from "./browser-page-state.js";
import type { BrowserSessionTabs } from "./browser-session-tabs.js";
import type { BrowserWorkspacePreview } from "./browser-workspace-preview.js";

export async function performBrowserConsoleOperation(input: {
  page: Page;
  recorder: BrowserConsoleRecorder;
  reused: boolean;
  operation: number;
  sessionIdSha256: string;
  executableSha256: string;
  browserVersionSha256: string;
  tabs: BrowserSessionTabs;
  blockedRequestCount: number;
  network: BrowserNetworkProxy;
  workspacePreview?: BrowserWorkspacePreview;
  signal?: AbortSignal;
}): Promise<BrowserSessionOperationResult> {
  const console = input.recorder.observation();
  const state = await captureBrowserPageMetadata(input.page, input.signal);
  return {
    output: console.output,
    details: createBrowserSessionDetails({
      action: "console",
      reused: input.reused,
      operation: input.operation,
      sessionIdSha256: input.sessionIdSha256,
      executableSha256: input.executableSha256,
      browserVersionSha256: input.browserVersionSha256,
      tabs: input.tabs.evidence(),
      state,
      crossOriginAuthorized: false,
      blockedRequestCount: input.blockedRequestCount,
      network: input.network.snapshot(),
      console,
      ...(input.workspacePreview
        ? { workspacePreview: input.workspacePreview.evidence }
        : {}),
    }),
  };
}
