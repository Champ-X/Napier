import type { Page } from "playwright-core";
import { BROWSER_TAKEOVER_KEYS } from "@napier/contracts/browser-takeover";

import {
  BROWSER_NAVIGATION_TIMEOUT_MS,
  BROWSER_VIEWPORT_HEIGHT,
  BROWSER_VIEWPORT_WIDTH,
  type BrowserSessionRequest,
  type BrowserSessionTabDescriptor,
} from "./browser-session-model.js";
import type { BrowserSessionPageState } from "./browser-session-details.js";
import type { BrowserSessionNavigation } from "./browser-session-navigation.js";
import type { BrowserSessionTabs } from "./browser-session-tabs.js";

export type BrowserTabRequest = Extract<
  BrowserSessionRequest,
  | { action: "tab_new" }
  | { action: "tab_list" }
  | { action: "tab_switch" }
  | { action: "tab_close" }
>;

type BrowserVisualTakeoverRequest = Extract<
  BrowserSessionRequest,
  { action: "visual_click" } | { action: "keypress" }
>;

export type BrowserPageSpecialRequest =
  | BrowserTabRequest
  | BrowserVisualTakeoverRequest;

export function isBrowserPageSpecialRequest(
  request: BrowserSessionRequest,
): request is BrowserPageSpecialRequest {
  return (
    request.action === "tab_new" ||
    request.action === "tab_list" ||
    request.action === "tab_switch" ||
    request.action === "tab_close" ||
    request.action === "visual_click" ||
    request.action === "keypress"
  );
}

export async function performBrowserPageSpecialOperation(input: {
  request: BrowserPageSpecialRequest;
  tabs: BrowserSessionTabs;
  navigation: BrowserSessionNavigation;
  preflightNavigation: (
    page: Page,
    value: string,
    allowCrossOrigin: boolean,
  ) => Promise<URL>;
  withNetwork: <T>(operation: () => Promise<T>) => Promise<T>;
  configurePage: (page: Page) => void;
  pageState: (
    page: Page,
    signal?: AbortSignal,
  ) => Promise<BrowserSessionPageState>;
  signal?: AbortSignal;
}): Promise<{
  state: BrowserSessionPageState;
  listedTabs?: BrowserSessionTabDescriptor[];
}> {
  const request = input.request;
  if (request.action === "visual_click") {
    if (
      !Number.isSafeInteger(request.x) ||
      request.x < 0 ||
      request.x >= BROWSER_VIEWPORT_WIDTH ||
      !Number.isSafeInteger(request.y) ||
      request.y < 0 ||
      request.y >= BROWSER_VIEWPORT_HEIGHT
    ) {
      throw new Error("Browser visual click coordinates are invalid");
    }
    const page = input.tabs.activePage;
    await input.withNetwork(() =>
      input.navigation.run(page, request.allowCrossOrigin === true, () =>
        page.mouse.click(request.x, request.y),
      ),
    );
    return { state: await input.pageState(page, input.signal) };
  }
  if (request.action === "keypress") {
    if (!BROWSER_TAKEOVER_KEYS.includes(request.key)) {
      throw new Error("Browser takeover key is invalid");
    }
    const page = input.tabs.activePage;
    await input.withNetwork(() =>
      input.navigation.run(page, request.allowCrossOrigin === true, () =>
        page.keyboard.press(request.key),
      ),
    );
    return { state: await input.pageState(page, input.signal) };
  }
  if (request.action === "tab_new") {
    const created = await input.tabs.create();
    input.configurePage(created.page);
    const url = await input.preflightNavigation(
      created.page,
      request.url,
      request.allowCrossOrigin === true,
    );
    await input.withNetwork(() =>
      input.navigation.run(
        created.page,
        request.allowCrossOrigin === true,
        () =>
          created.page.goto(url.href, {
            waitUntil: "domcontentloaded",
            timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
          }),
      ),
    );
    return {
      state: await input.pageState(created.page, input.signal),
    };
  }
  if (request.action === "tab_list") {
    return {
      state: await input.pageState(input.tabs.activePage, input.signal),
      listedTabs: await input.tabs.descriptors(),
    };
  }
  if (request.action === "tab_switch") {
    input.tabs.switch(request.tabId);
  } else {
    await input.tabs.close(request.tabId);
  }
  return {
    state: await input.pageState(input.tabs.activePage, input.signal),
  };
}
