/** Structured session-state error; its message is presentation-only. */
export class BrowserSessionInactiveError extends Error {
  constructor(options?: ErrorOptions) {
    super("Browser Session is not active for this Run", options);
    this.name = "BrowserSessionInactiveError";
  }
}
