import type { JsonObject, ModelContextEnvelopeReceipt, RunEvent, SubagentTask, Usage } from "@napier/contracts";
import { createId } from "./ids.js";
import type { ModelSessionLifetime } from "./model-session.js";
import type { FinishSubagentTaskInput } from "./subagent-store-records.js";
import { emitBestEffort, type EventSink } from "./event-sink.js";
import { RunBudgetTracker } from "./run-budget.js";
import type { PreparedSubagentWorkingSet, PrepareSubagentChildCheckpointResult, SubagentCheckpointStore } from "./subagent-working-set-types.js";
import type {
  StartedSubagentChildRun, SubagentChildInvocationPhase,
  SubagentChildRunState, SubagentChildExecutionStore,
} from "./subagent-child-run-types.js";

export type SubagentProgress = { turnDelta?: number; stepDelta?: number };
export type SubagentTaskFinisher = (
  finish: FinishSubagentTaskInput, assertActive?: () => void,
) => Promise<SubagentTask>;

/** One lease holder serializes execution revisions; heartbeats have their own revision. */
export class SubagentChildExecution {
  private state: SubagentChildRunState;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly leaseFailure = new AbortController();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private readonly pendingEvents: RunEvent[] = [];
  private publication: Promise<void> = Promise.resolve();
  readonly signal = this.leaseFailure.signal;

  constructor(private readonly store: SubagentChildExecutionStore & SubagentCheckpointStore, private readonly started: StartedSubagentChildRun,
    private readonly onEvent?: EventSink) {
    this.state = started;
    this.pendingEvents.push(...started.events ?? []);
  }

  get run() { return this.state.run; }
  get task() { return this.state.task; }

  startHeartbeat(): void {
    this.heartbeat = setInterval(() => {
      void this.store.renewRunLease(this.run.id, this.started.token, 60_000)
        .catch((error: unknown) => this.leaseFailure.abort(error));
    }, 20_000);
    this.heartbeat.unref?.();
  }

  dispose(): void { clearInterval(this.heartbeat); }

  assertActive(): void {
    this.signal.throwIfAborted();
    this.store.assertSubagentChildRunActive(this.fence());
  }

  assertCanInvoke(ownReservationPending = false): void {
    this.assertActive();
    const current = this.store.assertSubagentChildRunActive(this.fence());
    if (!ownReservationPending && current.run.usageStatus === "incomplete")
      throw new Error("Child model usage is unresolved; another invocation is not permitted");
    const budget = new RunBudgetTracker(current.run.limits!, current.run.startedAt);
    // Task turns (including repair) remain governed by the existing child
    // counter. Canonical usage supplies the same raw roll-up as parent budgets.
    budget.observeAuxiliaryUsage(current.run.usage);
    budget.assertCanStartAuxiliaryCall();
  }

  lifetime(parent: ModelSessionLifetime): ModelSessionLifetime {
    return {
      signal: AbortSignal.any([this.signal, ...(parent.signal ? [parent.signal] : [])]),
      remainingMs: () => parent.remainingMs(),
      assertActive: () => { parent.assertActive(); this.assertActive(); },
    };
  }

  reserve(phase: SubagentChildInvocationPhase) {
    return this.serialize(async () => {
      this.assertCanInvoke();
      const reservation = await this.store.reserveSubagentChildInvocation({
        ...this.fence(), phase, requestId: createId("modelrequest"),
      });
      this.state.executionRevision = reservation.executionRevision;
      this.pendingEvents.push(...reservation.events ?? []);
      await this.publish();
      return reservation;
    });
  }

  bindRoute(routePlanId: string): Promise<SubagentTask> {
    return this.serialize(async () => {
      this.state = await this.store.bindSubagentChildRoute({ ...this.fence(), routePlanId });
      return this.task;
    });
  }

  settle(invocationId: string, payload: JsonObject, usage?: Usage,
    capture?: { envelope: ModelContextEnvelopeReceipt; adapter?: JsonObject }): Promise<SubagentTask> {
    return this.serialize(async () => {
      this.state = await this.store.settleSubagentChildInvocation({
        ...this.fence(), invocationId, payload,
        ...(capture ? { capture } : {}),
        ...(usage ? { usage, usageStatus: "known" as const } : { usageStatus: "unknown" as const }),
      });
      this.pendingEvents.push(...this.state.events ?? []);
      await this.publish();
      return this.task;
    });
  }

  progress(delta: SubagentProgress): Promise<SubagentTask> {
    return this.serialize(async () => {
      this.state = await this.store.recordSubagentChildProgress({ ...this.fence(), ...delta });
      return this.task;
    });
  }

  checkpoint(prepare: (snapshot: PrepareSubagentChildCheckpointResult) => Promise<PreparedSubagentWorkingSet>): Promise<void> {
    return this.serialize(async () => {
      const snapshot = await this.store.prepareSubagentChildCheckpoint(this.fence());
      const prepared = await prepare(snapshot);
      this.state = await this.store.commitSubagentChildCheckpoint({ ...this.fence(), prepared });
      this.pendingEvents.push(...this.state.events ?? []);
      await this.publish();
    });
  }

  readonly finish: SubagentTaskFinisher = (finish, assertActive) => this.serialize(async () => {
    this.state = await this.store.finishSubagentChildRun({
      ...this.fence(), finish, ...(assertActive ? { assertActive } : {}),
    });
    this.pendingEvents.push(...this.state.events ?? []);
    return this.task;
  });

  /** Completion publishes only after the candidate ownership transfer returns. */
  publish(): Promise<void> {
    const events = this.pendingEvents.splice(0);
    const next = this.publication.then(async () => {
      for (const event of events) await emitBestEffort(this.onEvent, event);
    });
    this.publication = next;
    return next;
  }

  private fence() {
    return { runId: this.run.id, taskId: this.task.id,
      executionId: this.started.task.executionId!, token: this.started.token,
      expectedExecutionRevision: this.state.executionRevision };
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
