import { errors } from "playwright-core";

import { BrowserTargetTimeoutError } from "./browser-session-errors.js";

/** Only locator timeouts are target failures; network and capture errors stay separate. */
export async function withBrowserTargetActionFailure<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof errors.TimeoutError)) throw error;
    throw new BrowserTargetTimeoutError(error);
  }
}
