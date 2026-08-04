import { MAX_BROWSER_SESSION_OPERATIONS } from "./browser-session-model.js";

export function reserveBrowserOperation(
  current: number,
  count: boolean,
): number {
  if (count && current >= MAX_BROWSER_SESSION_OPERATIONS) {
    throw new Error("Browser Session operation limit reached");
  }
  return count ? current + 1 : current;
}
