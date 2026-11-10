/** Owns the in-flight Run SSE AbortController for one workspace view. */
export class ActiveRunStreamAbort {
  private controller: AbortController | undefined;

  begin(): AbortSignal {
    this.controller?.abort();
    const next = new AbortController();
    this.controller = next;
    return next.signal;
  }

  abort(): void {
    this.controller?.abort();
    this.controller = undefined;
  }

  release(signal: AbortSignal): void {
    if (this.controller?.signal === signal) this.controller = undefined;
  }
}
