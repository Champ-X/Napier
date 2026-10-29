/** Own every started refresh through settlement and audit persistence. A failed
 * sibling must not let stop finish while another operation still uses the store. */
export class ReceiptTrustSubscriptionWorker {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly failures = new Set<unknown>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private closed = false;
  private stopping: Promise<void> | undefined;

  constructor(
    private readonly tick: () => Promise<unknown>,
    private readonly pollIntervalMs: number,
  ) {}

  start(): void {
    if (this.closed)
      throw new Error("Receipt trust subscription worker is stopped");
    if (this.timer) return;
    this.timer = setInterval(() => this.scheduleTick(), this.pollIntervalMs);
    this.timer.unref();
    this.scheduleTick();
  }

  run<T>(
    operation: () => Promise<T>,
    retainFailure: () => boolean = () => true,
  ): Promise<T> {
    if (this.closed)
      return Promise.reject(
        new Error("Receipt trust subscription worker is stopped"),
      );
    const pending = Promise.resolve().then(operation);
    this.pending.add(pending);
    void pending.then(
      () => this.pending.delete(pending),
      (error: unknown) => {
        if (retainFailure()) this.failures.add(error);
        this.pending.delete(pending);
      },
    );
    return pending;
  }

  hasPendingWork(): boolean {
    return this.pending.size > 0 || this.failures.size > 0;
  }

  stop(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.stopping ??= this.drain();
    return this.stopping;
  }

  private scheduleTick(): void {
    if (this.closed || this.hasPendingWork()) return;
    void this.tick().catch(() => undefined);
  }

  private async drain(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    if (this.failures.size)
      throw new AggregateError(
        [...this.failures],
        "Receipt trust subscription work did not drain",
      );
  }
}

export async function settleReceiptTrustSubscriptionWork(
  operations: Promise<unknown>[],
): Promise<number> {
  const results = await Promise.allSettled(operations);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      "Receipt trust subscription operations failed",
    );
  return results.length;
}
