import type { Locator, Page } from "playwright-core";

import {
  preflightBrowserDownload,
  preflightBrowserScreenshot,
  type BrowserWorkspaceFile,
  writeBrowserDownload,
  writeBrowserScreenshot,
} from "./browser-workspace-files.js";
import {
  BROWSER_ACTION_TIMEOUT_MS,
  MAX_BROWSER_SCREENSHOT_BYTES,
  type BrowserSessionRequest,
} from "./browser-session-model.js";
import type { BrowserSessionPageState } from "./browser-session-details.js";
import type { BrowserSessionNavigation } from "./browser-session-navigation.js";
import {
  captureBrowserPageMetadata,
  captureBrowserPageState,
} from "./browser-page-state.js";
import { sha256 } from "./ed25519.js";

export type BrowserPageFileRequest = Extract<
  BrowserSessionRequest,
  { action: "download" } | { action: "save_screenshot" }
>;

export async function performBrowserPageFileOperation(input: {
  page: Page;
  request: BrowserPageFileRequest;
  workspaceRoot: string;
  navigation: BrowserSessionNavigation;
  locator: (page: Page, target: { ref?: string; selector?: string }) => Locator;
  preflightNavigation: (
    page: Page,
    value: string,
    allowCrossOrigin: boolean,
  ) => Promise<URL>;
  withNetwork: <T>(operation: () => Promise<T>) => Promise<T>;
  setDownloadAuthorized: (authorized: boolean) => void;
  signal?: AbortSignal;
}): Promise<{
  state: BrowserSessionPageState;
  file: BrowserWorkspaceFile;
  suggestedFilenameSha256?: string;
}> {
  if (input.request.action === "download") {
    return await downloadBrowserPageFile({
      ...input,
      request: input.request,
    });
  }
  return await saveBrowserPageScreenshot({
    ...input,
    request: input.request,
  });
}

export function isBrowserPageFileRequest(
  request: BrowserSessionRequest,
): request is BrowserPageFileRequest {
  return request.action === "download" || request.action === "save_screenshot";
}

async function downloadBrowserPageFile(
  input: Parameters<typeof performBrowserPageFileOperation>[0] & {
    request: Extract<BrowserPageFileRequest, { action: "download" }>;
  },
) {
  await input.preflightNavigation(
    input.page,
    input.page.url(),
    input.request.allowCrossOrigin === true,
  );
  await preflightBrowserDownload(input.workspaceRoot, input.request.path);
  assertNotAborted(input.signal);
  let file!: BrowserWorkspaceFile;
  let suggestedFilenameSha256!: string;
  await input.withNetwork(async () => {
    input.setDownloadAuthorized(true);
    try {
      const [download] = await Promise.all([
        input.page.waitForEvent("download", {
          timeout: BROWSER_ACTION_TIMEOUT_MS,
          ...(input.signal ? { signal: input.signal } : {}),
        }),
        input.navigation.run(
          input.page,
          input.request.allowCrossOrigin === true,
          () =>
            input.locator(input.page, input.request.target).click({
              timeout: BROWSER_ACTION_TIMEOUT_MS,
            }),
        ),
      ]);
      suggestedFilenameSha256 = sha256(download.suggestedFilename());
      const stream = await download.createReadStream();
      try {
        file = await writeBrowserDownload(
          input.workspaceRoot,
          input.request.path,
          stream,
          input.signal,
        );
      } finally {
        await download.delete().catch(() => undefined);
      }
    } finally {
      input.setDownloadAuthorized(false);
    }
  });
  return {
    state: await captureBrowserPageState(input.page, input.signal),
    file,
    suggestedFilenameSha256,
  };
}

async function saveBrowserPageScreenshot(
  input: Parameters<typeof performBrowserPageFileOperation>[0] & {
    request: Extract<BrowserPageFileRequest, { action: "save_screenshot" }>;
  },
) {
  await preflightBrowserScreenshot(input.workspaceRoot, input.request.path);
  const screenshot = await input.page.screenshot({
    type: "png",
    fullPage: false,
    animations: "disabled",
    timeout: BROWSER_ACTION_TIMEOUT_MS,
  });
  if (
    screenshot.byteLength > MAX_BROWSER_SCREENSHOT_BYTES ||
    sha256(screenshot) !== input.request.expectedLiveImageSha256
  ) {
    throw new Error("Browser takeover live viewport changed");
  }
  return {
    state: await captureBrowserPageMetadata(input.page, input.signal),
    file: await writeBrowserScreenshot(
      input.workspaceRoot,
      input.request.path,
      screenshot,
      input.signal,
    ),
  };
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Browser Session operation was cancelled");
  }
}
