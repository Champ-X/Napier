import type { Locator, Page } from "playwright-core";

import type { BrowserElementTarget } from "./browser-session-model.js";

export function browserPageLocator(
  page: Page,
  target: BrowserElementTarget,
): Locator {
  const ref = target.ref?.trim();
  const selector = target.selector?.trim();
  if (Boolean(ref) === Boolean(selector)) {
    throw new Error("Browser target requires exactly one ref or selector");
  }
  if (ref) {
    if (!/^[a-z0-9]{1,40}$/u.test(ref)) {
      throw new Error("Browser target ref is invalid");
    }
    return page.locator(`aria-ref=${ref}`);
  }
  if (!selector || selector.length > 1_000) {
    throw new Error("Browser target selector is invalid");
  }
  return page.locator(selector);
}
