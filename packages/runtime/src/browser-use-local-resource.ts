import { randomUUID } from "node:crypto";

import type { ExecutionResourceLease } from "./execution-resource-admission.js";

export interface BrowserUseLocalCleanupAck {
  type: "cleanup";
  backend: "browser_use_local";
  schemaVersion: 1;
  runNonce: string;
  status: "released" | "unknown";
}

/** The bridge owns BrowserUse's session; child exit alone does not prove that
 * its browser closed. Only a nonce-bound ACK after agent.close can release it. */
export class BrowserUseLocalResource {
  readonly runNonce = randomUUID().replaceAll("-", "");
  private spawnAttempted = false;
  private knownNotStarted = false;
  private childClosed = false;
  private cleanup: "released" | "unknown" | undefined;
  private invalidCleanup = false;
  private settled = false;

  constructor(private readonly lease: ExecutionResourceLease | undefined) {}

  dispatch(): void {
    this.lease?.dispatched();
    this.lease?.bind({ resourceId: this.runNonce });
    this.spawnAttempted = true;
  }

  notStarted(): void { this.knownNotStarted = true; }
  closed(): void { this.childClosed = true; }

  acknowledge(value: BrowserUseLocalCleanupAck): boolean {
    const valid = value.backend === "browser_use_local" && value.schemaVersion === 1 &&
      value.runNonce === this.runNonce && (value.status === "released" || value.status === "unknown") &&
      Object.keys(value).length === 5 &&
      (this.cleanup === undefined || this.cleanup === value.status);
    if (!valid) this.invalidCleanup = true;
    else this.cleanup = value.status;
    return valid;
  }

  settle(cause?: unknown): void {
    if (this.settled) return;
    this.settled = true;
    const status = !this.spawnAttempted || this.knownNotStarted
      ? "not_started"
      : this.childClosed && this.cleanup === "released" && !this.invalidCleanup
        ? "released"
        : "unknown";
    try {
      this.lease?.settle({
        status, scope: "browser_task",
        reason: status === "not_started" ? "browser_use_local_not_started"
          : status === "released" ? "browser_use_local_cleanup_confirmed"
            : "browser_use_local_cleanup_unconfirmed",
      });
    } catch (error) {
      throw new AggregateError(cause === undefined ? [error] : [cause, error],
        "Browser Use local resource evidence could not be saved", { cause });
    }
  }
}
