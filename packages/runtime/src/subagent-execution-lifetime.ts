import type { ModelSessionLifetime } from "./model-session.js";

/** One absolute deadline for setup, turns, repair and final settlement. */
export class SubagentExecutionLifetime implements ModelSessionLifetime {
  readonly signal: AbortSignal;
  private readonly deadline: number;
  private readonly timeout = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(signals: readonly AbortSignal[], timeoutMs: number, deadlineMs?: number) {
    this.deadline = deadlineMs ?? Date.now() + timeoutMs;
    if (!Number.isFinite(this.deadline)) throw new Error("Subagent deadline is invalid");
    this.signal = AbortSignal.any([...signals, this.timeout.signal]);
  }

  get timedOut(): boolean {
    return this.timeout.signal.aborted || Date.now() >= this.deadline;
  }

  remainingMs(): number {
    return Math.max(0, this.deadline - Date.now());
  }

  assertActive(): void {
    if (this.timedOut) throw new Error("Subagent task timed out");
    if (this.signal.aborted) throw new Error("Subagent task cancelled");
  }

  start(): void {
    this.timer = setTimeout(() => this.timeout.abort(), this.remainingMs());
    this.timer.unref?.();
  }

  dispose(): void {
    clearTimeout(this.timer);
  }
}
