export class BrowserTaskServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: 400 | 404 | 409 | 503,
    readonly recovery?: string,
  ) {
    super(message);
    this.name = "BrowserTaskServiceError";
  }
}
