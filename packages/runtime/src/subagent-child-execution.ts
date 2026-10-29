import type { JsonObject, ModelContextEnvelopeReceipt, RunEvent, SubagentTask, Usage } from "@napier/contracts";
import { createId } from "./ids.js";
import type { ModelSessionLifetime } from "./model-session.js";
import type { FinishSubagentTaskInput } from "./subagent-completion-types.js";
import type { PreparedSubagentCompletion } from "./subagent-completion-types.js";
import { emitBestEffort, type EventSink } from "./event-sink.js";
import { createSubagentRunBudget, subagentAdmissionAccounting } from "./subagent-budget-projection.js";
import { SubagentModelTurnDeniedError } from "./subagent-model-turn-denial.js";
import type { PreparedSubagentWorkingSet, PrepareSubagentChildCheckpointResult, SubagentCheckpointStore } from "./subagent-working-set-types.js";
import type {
  StartedSubagentChildRun, SubagentChildInvocationPhase,
  SubagentChildRunState, SubagentChildExecutionStore,
} from "./subagent-child-run-types.js";
import type { ModelInvocationAccounting } from "./model-call-accounting-driver.js";

export type SubagentProgress = { turnDelta?: number; stepDelta?: number };
export interface SubagentTaskFinisher {
  (finish: FinishSubagentTaskInput, assertActive?: () => void): Promise<SubagentTask>;
  prepareCompletion?: (finish: FinishSubagentTaskInput, assertActive?: () => void) => Promise<PreparedSubagentCompletion>;
}

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
    if (current.task.completionReservation)
      throw new Error("Child completion is reserved; model execution cannot restart");
    if (!ownReservationPending && current.run.usageStatus === "incomplete")
      throw new Error("Child model usage is unresolved; another invocation is not permitted");
    this.createBudget().assertCanStartAuxiliaryCall();
  }

  createBudget() {
    const current = this.store.assertSubagentChildRunActive(this.fence());
    const runs = this.store.listRuns?.(this.run.threadId) ?? [];
    const budget = createSubagentRunBudget(current.run, runs);
    const repository = this.store.modelAccountingRepository;
    if (repository?.isConfigured()) budget.bindAccounting(async () => subagentAdmissionAccounting(current.run,
      await repository.readRunAccounting(current.run.id), runs));
    return budget;
  }

  assertTurnAvailable(): void {
    this.assertActive();
    const current = this.store.assertSubagentChildRunActive(this.fence());
    const inherited = current.run.subagent?.continuation?.budget;
    const maxTurns = inherited?.limits.maxTurns ?? current.run.limits!.maxTurns;
    if (current.task.turnCount + (inherited?.inheritedTurnCount ?? 0) >= maxTurns)
      throw new SubagentModelTurnDeniedError(maxTurns);
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

  accountingForInvocation(reservation: { invocationId: string; invocationIndex: number }): ModelInvocationAccounting | undefined {
    const repository = this.store.modelAccountingRepository;
    if (!repository || !repository.isConfigured()) return undefined;
    return { repository, logicalCallId: reservation.invocationId,
      owner: repository.childAuthority({ ...this.fence(), kind: "child", threadId: this.run.threadId,
        parentRunId: this.task.runId, childInvocationId: reservation.invocationId,
        invocationIndex: reservation.invocationIndex }) };
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

  readonly finish: SubagentTaskFinisher = Object.assign((finish: FinishSubagentTaskInput, assertActive?: () => void) => this.serialize(async () => {
    this.state = await this.store.finishSubagentChildRun({
      ...this.fence(), finish, ...(assertActive ? { assertActive } : {}),
    });
    this.pendingEvents.push(...this.state.events ?? []);
    return this.task;
  }), { prepareCompletion: (finish: FinishSubagentTaskInput, assertActive?: () => void) => this.serialize(async () => {
    const ready = await this.store.prepareSubagentChildCompletion({ ...this.fence(), finish, ...(assertActive ? { assertActive } : {}) });
    this.state = ready;
    return ready.prepared;
  }) });

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
