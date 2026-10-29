import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { sha256 } from "./ed25519.js";
import {
  ExecutionResourceLaunchError,
  type ExecutionResourceAdmission,
  type ExecutionResourceLease,
} from "./execution-resource-admission.js";

export class BrowserSessionCleanupError extends AggregateError {
  constructor(errors: unknown[], options?: ErrorOptions) {
    super(errors, "Browser Session resources did not close", options);
    this.name = "BrowserSessionCleanupError";
  }
}

interface BrowserSessionResources {
  context?: { close(): Promise<void> };
  browser?: { close(): Promise<void> };
  proxy?: { close(): Promise<void> };
  runtimeRoot?: string;
  cause?: unknown;
}

/** One lease owns preparation and all handles of one native browser session.
 * A launcher that throws without returning a handle leaves cleanup uncertain. */
export class BrowserSessionResourceOwner {
  readonly idSha256 = sha256(`browser-session:${randomUUID()}`);
  private readonly lease: ExecutionResourceLease | undefined;
  private attempted = false;
  private unidentified = false;
  private closing: Promise<void> | undefined;

  constructor(admission: ExecutionResourceAdmission | undefined) {
    this.lease = admission?.reserve({ kind: "browser_session", backend: "playwright_chromium" });
  }

  dispatched(): void {
    this.lease?.dispatched();
    this.lease?.bind({ resourceId: this.idSha256 });
  }

  attemptingResource(): void { this.attempted = true; this.unidentified = true; }
  identifiedResource(): void { this.unidentified = false; }

  close(input: BrowserSessionResources): Promise<void> {
    this.closing ??= this.release(input);
    return this.closing;
  }

  private async release(input: BrowserSessionResources): Promise<void> {
    try {
      const affirmedLaunchFailure = input.cause instanceof ExecutionResourceLaunchError &&
        input.cause.cleanup.scope === "browser_session" && input.cause.cleanup.status !== "unknown";
      const unknownLaunch = this.unidentified && !affirmedLaunchFailure;
      await closeBrowserSessionResources(input, !unknownLaunch);
      if (unknownLaunch) {
        throw new BrowserSessionCleanupError([new Error("Browser launch did not return an owned resource handle")], { cause: input.cause });
      }
      this.lease?.settle({
        status: this.attempted ? "released" : "not_started", scope: "browser_session",
        reason: this.attempted ? "browser_session_closed" : "browser_session_not_started",
      });
    } catch (error) {
      const failures = [error];
      try {
        this.lease?.settle({ status: "unknown", scope: "browser_session", reason: "browser_session_cleanup_unconfirmed" });
      } catch (settlement) { failures.push(settlement); }
      if (failures.length === 1 && error instanceof BrowserSessionCleanupError) throw error;
      throw new BrowserSessionCleanupError(failures, { cause: input.cause });
    }
  }
}

/** Attempt every owned cleanup, but retain the private runtime directory when
 * a resource may still be using it. A failed close is never successful release. */
async function closeBrowserSessionResources(input: BrowserSessionResources, removeRuntimeRoot: boolean): Promise<void> {
  const failures: unknown[] = [];
  // Context closure precedes browser closure so the latter cannot interrupt the
  // former and manufacture a target-closed failure during ordinary shutdown.
  for (const resource of [input.context, input.browser, input.proxy]) {
    if (!resource) continue;
    try { await resource.close(); }
    catch (error) { failures.push(error); }
  }
  if (failures.length === 0 && removeRuntimeRoot && input.runtimeRoot) {
    try { await rm(input.runtimeRoot, { recursive: true, force: true }); }
    catch (error) { failures.push(error); }
  }
  if (failures.length) {
    throw new BrowserSessionCleanupError(failures, { cause: input.cause });
  }
}

export async function abortBrowserSessionOperation<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort: () => Promise<void>,
): Promise<T> {
  if (!signal) return operation;
  // The operation already exists: observe rejection even for an early abort.
  void operation.catch(() => undefined);
  if (signal.aborted) {
    await onAbort();
    throw new Error("Browser Session operation was cancelled");
  }
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => {
      void onAbort().then(
        () => reject(new Error("Browser Session operation was cancelled")),
        (error: unknown) => reject(error),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([operation, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}
