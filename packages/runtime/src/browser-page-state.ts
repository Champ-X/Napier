import type { Page } from "playwright-core";

import { diagnoseBrowserPage } from "./browser-page-diagnosis.js";
import {
  BROWSER_ACTION_TIMEOUT_MS,
  MAX_BROWSER_SNAPSHOT_CHARS,
} from "./browser-session-model.js";
import type { BrowserSessionPageState } from "./browser-session-details.js";
import { browserPageOrigin } from "./browser-session-navigation.js";

export async function captureBrowserPageState(
  page: Page,
  signal?: AbortSignal,
): Promise<BrowserSessionPageState> {
  const metadata = await captureBrowserPageMetadata(page, signal);
  const raw = await page.locator("body").ariaSnapshot({
    mode: "ai",
    depth: 20,
    timeout: BROWSER_ACTION_TIMEOUT_MS,
    ...(signal ? { signal } : {}),
  });
  const snapshot =
    raw.length > MAX_BROWSER_SNAPSHOT_CHARS
      ? raw.slice(0, MAX_BROWSER_SNAPSHOT_CHARS)
      : raw;
  return {
    ...metadata,
    snapshot,
    snapshotTruncated: raw.length > snapshot.length,
  };
}

export async function captureBrowserPageMetadata(
  page: Page,
  signal?: AbortSignal,
): Promise<BrowserSessionPageState> {
  const url = page.url().slice(0, 4_096);
  const [title, diagnosis] = await Promise.all([
    page.title(),
    diagnoseBrowserPage(page, signal),
  ]);
  return {
    url,
    origin: browserPageOrigin(url) ?? "",
    title: title.slice(0, 512),
    diagnosis,
  };
}
