import type { Page } from "playwright-core";

import type {
  BrowserPreparedUpload,
  BrowserWorkspaceFile,
} from "./browser-workspace-files.js";
import { browserPageLocator } from "./browser-page-locator.js";
import {
  BROWSER_ACTION_TIMEOUT_MS,
  BROWSER_NAVIGATION_TIMEOUT_MS,
  MAX_BROWSER_SCREENSHOT_BYTES,
  MAX_BROWSER_WAIT_MS,
  type BrowserSessionRequest,
} from "./browser-session-model.js";
import type { BrowserSessionNavigation } from "./browser-session-navigation.js";
import type { BrowserSessionPageState } from "./browser-session-details.js";
import {
  captureBrowserPageMetadata,
  captureBrowserPageState,
} from "./browser-page-state.js";
import { performBrowserPageUpload } from "./browser-page-upload.js";

type BrowserCoreRequest = Extract<
  BrowserSessionRequest,
  | { action: "start" }
  | { action: "navigate" }
  | { action: "back" }
  | { action: "forward" }
  | { action: "wait" }
  | { action: "snapshot" }
  | { action: "click" }
  | { action: "type" }
  | { action: "select" }
  | { action: "upload" }
  | { action: "screenshot" }
  | { action: "close" }
>;

export async function performBrowserPageCoreOperation(input: {
  page: Page;
  request: BrowserCoreRequest;
  workspaceRoot: string;
  navigation: BrowserSessionNavigation;
  preflightNavigation: (
    page: Page,
    value: string,
    allowCrossOrigin: boolean,
  ) => Promise<URL>;
  withNetwork: <T>(operation: () => Promise<T>) => Promise<T>;
  preparedUpload?: BrowserPreparedUpload;
  signal?: AbortSignal;
}): Promise<{
  state: BrowserSessionPageState;
  file?: BrowserWorkspaceFile;
  screenshot?: Buffer;
}> {
  const { page, request } = input;
  switch (request.action) {
    case "start":
    case "navigate": {
      const url = await input.preflightNavigation(
        page,
        request.url,
        request.allowCrossOrigin === true,
      );
      await input.withNetwork(() =>
        input.navigation.run(page, request.allowCrossOrigin === true, () =>
          page.goto(url.href, {
            waitUntil: "domcontentloaded",
            timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
          }),
        ),
      );
      break;
    }
    case "back":
    case "forward":
      await navigateHistory(input, request.action);
      break;
    case "wait":
      await input.withNetwork(() =>
        page.waitForTimeout(
          Math.min(request.durationMs ?? 1_000, MAX_BROWSER_WAIT_MS),
        ),
      );
      break;
    case "click":
      await input.withNetwork(() =>
        input.navigation.run(page, request.allowCrossOrigin === true, () =>
          browserPageLocator(page, request.target).click({
            timeout: BROWSER_ACTION_TIMEOUT_MS,
          }),
        ),
      );
      break;
    case "type":
      await input.withNetwork(() =>
        browserPageLocator(page, request.target).fill(request.text, {
          timeout: BROWSER_ACTION_TIMEOUT_MS,
        }),
      );
      break;
    case "select":
      await input.withNetwork(() =>
        browserPageLocator(page, request.target).selectOption(request.values, {
          timeout: BROWSER_ACTION_TIMEOUT_MS,
        }),
      );
      break;
    case "upload": {
      const file = await performBrowserPageUpload({
        page,
        target: request.target,
        path: request.path,
        workspaceRoot: input.workspaceRoot,
        ...(input.preparedUpload ? { prepared: input.preparedUpload } : {}),
        locator: browserPageLocator,
        withNetwork: input.withNetwork,
      });
      return {
        file,
        state: await captureBrowserPageState(page, input.signal),
      };
    }
    case "screenshot": {
      const screenshot = await page.screenshot({
        type: "png",
        fullPage: false,
        animations: "disabled",
        timeout: BROWSER_ACTION_TIMEOUT_MS,
      });
      if (screenshot.byteLength > MAX_BROWSER_SCREENSHOT_BYTES) {
        throw new Error("Browser screenshot exceeds the output limit");
      }
      return {
        screenshot,
        state: await captureBrowserPageMetadata(page, input.signal),
      };
    }
    case "close":
      return { state: await captureBrowserPageMetadata(page, input.signal) };
    case "snapshot":
      break;
  }
  return { state: await captureBrowserPageState(page, input.signal) };
}

async function navigateHistory(
  input: Parameters<typeof performBrowserPageCoreOperation>[0],
  action: "back" | "forward",
): Promise<void> {
  const request = input.request as Extract<
    BrowserCoreRequest,
    { action: "back" | "forward" }
  >;
  await input.withNetwork(() =>
    input.navigation.run(
      input.page,
      request.allowCrossOrigin === true,
      async () => {
        const response = await input.page[
          action === "back" ? "goBack" : "goForward"
        ]({
          waitUntil: "domcontentloaded",
          timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
        });
        if (!response) {
          throw new Error(`Browser Session has no ${action} entry`);
        }
      },
    ),
  );
}
