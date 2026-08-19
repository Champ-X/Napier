import type { RunEvent } from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import { KernelHookRegistry } from "./kernel-hooks.js";

export interface KernelCompletionControlProjection {
  total: number;
  counts: Record<string, number>;
  latest?: { type: string; runId: string; seq: number };
}

export class KernelCompletionControlObserver {
  private readonly counts = new Map<string, number>();
  private latest: KernelCompletionControlProjection["latest"];
  private unsubscribe: (() => void) | undefined;

  attach(hooks: KernelHookRegistry): void {
    this.unsubscribe = hooks.on(
      "completion.control",
      ({ control, event, runId }) => {
        this.counts.set(control, (this.counts.get(control) ?? 0) + 1);
        this.latest = { type: control, runId, seq: event.seq };
      },
      "kernel.completion-control",
    );
  }

  inspect(): KernelCompletionControlProjection {
    return {
      total: [...this.counts.values()].reduce(
        (total, count) => total + count,
        0,
      ),
      counts: Object.fromEntries(
        [...this.counts].sort(([left], [right]) => left.localeCompare(right)),
      ),
      ...(this.latest ? { latest: { ...this.latest } } : {}),
    };
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}

export function composeEventSink(
  hooks: KernelHookRegistry,
  sink: EventSink | undefined,
): EventSink {
  return async (event: RunEvent) => {
    await hooks.observe(event);
    await sink?.(event);
  };
}
