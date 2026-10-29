import type { WorkspaceProcessStatus } from "@napier/contracts";
import { reserveWorkspaceProcessStart } from "./workspace-process-admission.js";

/** A process remains owned through preparation, execution, persisted settlement,
 * compensation and lock cleanup, even after its projected status is terminal. */
export class WorkspaceProcessLifetime {
  private readonly startingByThread = new Map<string, number>();
  private readonly starts = new Set<Promise<unknown>>();
  private readonly pending = new Set<Promise<unknown>>();
  private stopping: Promise<void> | undefined;

  constructor(
    private readonly maximumGlobal: number,
    private readonly maximumPerThread: number,
  ) {}

  hasPendingWork(): boolean {
    return this.pending.size > 0;
  }

  start<T>(
    threadId: string,
    sessions: Iterable<{ threadId: string; status: WorkspaceProcessStatus }>,
    operation: (releaseAdmission: () => void) => Promise<T>,
  ): Promise<T> {
    const releaseAdmission = reserveWorkspaceProcessStart({
      sessions,
      threadId,
      startingByThread: this.startingByThread,
      maximumGlobal: this.maximumGlobal,
      maximumPerThread: this.maximumPerThread,
    });
    return this.track(
      this.track(
        (async () => {
          try {
            return await operation(releaseAdmission);
          } finally {
            releaseAdmission();
          }
        })(),
        this.starts,
      ),
    );
  }

  track<T>(operation: Promise<T>, pending = this.pending): Promise<T> {
    const tracked = operation.finally(() => {
      pending.delete(tracked);
    });
    pending.add(tracked);
    return tracked;
  }

  shutdown(
    stopProcesses: () => void,
    finalize: () => Promise<void>,
  ): Promise<void> {
    return (this.stopping ??= (async () => {
      // A launch may have passed its last shutdown check but not registered its
      // entry yet. Finish every admitted start before taking the stop snapshot.
      while (this.starts.size > 0) await Promise.allSettled([...this.starts]);
      stopProcesses();
      while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
      await finalize();
    })());
  }
}
