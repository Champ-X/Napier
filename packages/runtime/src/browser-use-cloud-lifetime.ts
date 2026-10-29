import { setTimeout as delay } from "node:timers/promises";
import type { ExecutionResourceLease } from "./execution-resource-admission.js";
import {
  BrowserUseCloudClient,
  browserUseCloudPublicError,
  type BrowserUseCloudProviderTask,
} from "./browser-use-cloud-client.js";

/** A remote task slot ends at an observed provider terminal, not a successful
 * stop request. This does not account provider sessions outside that task. */
export class BrowserUseCloudLifetime {
  private dispatched = false;
  private providerTaskId: string | undefined;
  private terminal = false;
  private stopping: Promise<void> | undefined;

  constructor(
    private readonly client: BrowserUseCloudClient,
    private readonly lease: ExecutionResourceLease | undefined,
    private readonly pollIntervalMs: number,
    private readonly cleanupTimeoutMs = 10_000,
  ) {}

  dispatch(): void {
    this.lease?.dispatched();
    this.dispatched = true;
  }

  bind(providerTaskId: string): void {
    this.providerTaskId = providerTaskId;
    this.lease?.bind({ resourceId: providerTaskId });
  }

  observe(task: BrowserUseCloudProviderTask): void {
    if (task.id !== this.providerTaskId)
      throw new Error("Browser Use Cloud task identity changed");
    if (["finished", "failed", "stopped"].includes(task.status))
      this.terminal = true;
  }

  stop(): Promise<void> {
    if (this.terminal) return Promise.resolve();
    this.stopping ??= this.stopAndConfirm();
    return this.stopping;
  }

  async finish(cause: unknown): Promise<void> {
    let cleanupFailure: unknown;
    if (this.providerTaskId && !this.terminal) {
      try {
        await this.stop();
      } catch (error) {
        cleanupFailure = error;
      }
    }
    const status = !this.dispatched
      ? "not_started"
      : this.terminal
        ? "released"
        : "unknown";
    try {
      this.lease?.settle({
        status,
        scope: "browser_task",
        reason:
          status === "released"
            ? "cloud_task_terminal_confirmed"
            : status === "not_started"
              ? "cloud_task_not_started"
              : "cloud_task_terminal_unconfirmed",
      });
    } catch (error) {
      throw browserUseCloudPublicError(
        "Browser task resource accounting failed",
        "resource_accounting_failed",
        "Inspect the local resource ledger before starting another browser task",
        {
          cause: new AggregateError(
            [cause, cleanupFailure, error].filter(
              (value) => value !== undefined,
            ),
          ),
        },
      );
    }
    if (status === "unknown") {
      throw browserUseCloudPublicError(
        "Browser Use Cloud task cleanup could not be confirmed",
        "resource_cleanup_unconfirmed",
        "Inspect the provider task before retrying; its capacity remains reserved",
        {
          cause: new AggregateError(
            [cause, cleanupFailure].filter((value) => value !== undefined),
          ),
        },
      );
    }
  }

  private async stopAndConfirm(): Promise<void> {
    const id = this.providerTaskId;
    if (!id) throw new Error("Browser Use Cloud task identity is unavailable");
    const signal = AbortSignal.timeout(this.cleanupTimeoutMs);
    await this.client.stopTask(id, signal);
    while (!this.terminal) {
      signal.throwIfAborted();
      this.observe(await this.client.getTask(id, signal));
      if (!this.terminal)
        await delay(this.pollIntervalMs, undefined, { signal });
    }
  }
}
