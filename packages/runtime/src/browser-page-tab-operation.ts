import type { Page } from "playwright-core";

import {
  BROWSER_NAVIGATION_TIMEOUT_MS,
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

export function isBrowserTabRequest(
  request: BrowserSessionRequest,
): request is BrowserTabRequest {
  return (
    request.action === "tab_new" ||
    request.action === "tab_list" ||
    request.action === "tab_switch" ||
    request.action === "tab_close"
  );
}

export async function performBrowserTabOperation(input: {
  request: BrowserTabRequest;
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
