import type { Page } from "playwright-core";

import type { BrowserAllowedUrls } from "./browser-allowed-url.js";
import { createBrowserPageOperationResult } from "./browser-page-output.js";
import { createBrowserSessionDetails } from "./browser-session-details.js";
import {
  BROWSER_NAVIGATION_TIMEOUT_MS,
  type BrowserNetworkProxy,
  type BrowserSessionOperationResult,
} from "./browser-session-model.js";
import type { BrowserSessionNavigation } from "./browser-session-navigation.js";
import { captureBrowserPageState } from "./browser-page-state.js";
import type { BrowserSessionTabs } from "./browser-session-tabs.js";
import { BrowserWorkspacePreview } from "./browser-workspace-preview.js";

export async function performBrowserWorkspacePreview(input: {
  page: Page;
  workspaceRoot: string;
  path: string;
  urls: BrowserAllowedUrls;
  navigation: BrowserSessionNavigation;
  reused: boolean;
  operation: number;
  sessionIdSha256: string;
  executableSha256: string;
  browserVersionSha256: string;
  tabs: BrowserSessionTabs;
  blockedRequestCount: number;
  network: BrowserNetworkProxy;
  signal?: AbortSignal;
}): Promise<{
  preview: BrowserWorkspacePreview;
  result: BrowserSessionOperationResult;
}> {
  const preview = await BrowserWorkspacePreview.create(
    input.workspaceRoot,
    input.path,
  );
  input.urls.enableWorkspacePreview(preview);
  const url = await input.urls.resolve(preview.entryUrl);
  await input.navigation.preflight(input.page, url, false);
  await input.navigation.run(input.page, false, () =>
    input.page.goto(url.href, {
      waitUntil: "domcontentloaded",
      timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
    }),
  );
  const state = await captureBrowserPageState(input.page, input.signal);
  const details = createBrowserSessionDetails({
    action: "preview_workspace",
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
    workspacePreview: preview.evidence,
  });
  return {
    preview,
    result: createBrowserPageOperationResult({
      request: { action: "preview_workspace", path: input.path },
      state,
      details,
      file: undefined,
      tabs: undefined,
      screenshot: undefined,
    }),
  };
}
