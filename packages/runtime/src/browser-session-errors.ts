/** Structured session-state error; its message is presentation-only. */
export class BrowserSessionInactiveError extends Error {
  constructor(options?: ErrorOptions) {
    super("Browser Session is not active for this Run", options);
    this.name = "BrowserSessionInactiveError";
  }
}

/** A locator timed out; the action may have taken effect before its timeout. */
export class BrowserTargetTimeoutError extends Error {
  constructor(cause: Error) {
    super(
      "Browser target interaction timed out. Take a fresh snapshot or screenshot to check the current page and whether the control is visible, enabled, or covered. For a workspace preview, repair hidden or obstructed controls before retrying. Check whether the action already took effect before repeating it.\n\n" +
        cause.message,
      { cause },
    );
    this.name = "BrowserTargetTimeoutError";
  }
}
