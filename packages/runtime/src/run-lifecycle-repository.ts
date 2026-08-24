import { timingSafeEqual } from "node:crypto";

import type {
  RunEvent,
  RunRecord,
  RunStatus,
  ThreadRecord,
} from "@napier/contracts";

import { nowIso } from "./ids.js";
import { projectOperatorDecisions } from "./operator-decisions.js";
import { reconcileInterruptedRuns } from "./run-interruption-recovery.js";
import {
  cancelPendingOperatorDecisions,
  cancelPendingRunControlMessages,
  operatorDecisionCancellationReason,
  runControlMessageCancellationReason,
} from "./run-lifecycle-cancellation.js";
import { applyOutcome, settleThread } from "./run-outcomes.js";
import { storeSha256 as sha256 } from "./store-hashing.js";
import type {
  StorePersistedRunRecord,
  StoreRepositoryHost,
  StoreRepositoryState,
} from "./store-repository-host.js";

export interface FinishRunOptions {
  error?: string;
  outcome?: NonNullable<RunRecord["outcome"]>;
  usage?: RunRecord["usage"];
  leaseToken?: string;
  waitForOperatorDecisionId?: string;
}

export class RunLifecycleRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  async finishRun(
    runId: string,
    status: Exclude<RunStatus, "queued" | "running">,
    options: FinishRunOptions = {},
  ): Promise<RunRecord> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const run = this.host.mutableRun(runId);
      assertRunLease(run, options.leaseToken);
      const thread = this.host.mutableThread(run.threadId);
      const currentEvents = this.host.requireLedger().listEvents(thread.id);
      const waitingDecision = findWaitingDecision(
        currentEvents,
        run.id,
        options.waitForOperatorDecisionId,
      );
      assertWaitingDecision(
        status,
        options.waitForOperatorDecisionId,
        waitingDecision,
      );
      settleRunRecord(run, status, options);
      thread.updatedAt = run.finishedAt!;
      const remainingActiveRuns = activeRunsAfter(
        this.host.state,
        thread,
        run.id,
      );
      replaceCurrentRun(thread, run.id, remainingActiveRuns);
      const cancellationEvents = this.cancelPendingInteractions(
        thread,
        run.id,
        status,
        waitingDecision?.id,
      );
      const openDecision = projectOperatorDecisions([
        ...currentEvents,
        ...cancellationEvents,
      ]).find(
        (decision) =>
          decision.status === "pending" || decision.status === "answered",
      );
      thread.status = settleThread(
        status,
        options.outcome,
        remainingActiveRuns.length > 0,
        Boolean(waitingDecision || openDecision),
      );
      await this.host.persistState(cancellationEvents);
      return stripRunSecrets(run);
    });
  }

  async reconcileInterruptedRuns(interruptActiveLeases = false): Promise<void> {
    await reconcileInterruptedRuns(this.host, interruptActiveLeases);
  }

  private cancelPendingInteractions(
    thread: ThreadRecord,
    runId: string,
    status: Exclude<RunStatus, "queued" | "running">,
    preservedDecisionId?: string,
  ): RunEvent[] {
    return [
      ...cancelPendingRunControlMessages(
        this.host,
        thread,
        runId,
        runControlMessageCancellationReason(status),
      ),
      ...cancelPendingOperatorDecisions(
        this.host,
        thread,
        runId,
        operatorDecisionCancellationReason(status),
        preservedDecisionId,
      ),
    ];
  }
}

function findWaitingDecision(
  events: RunEvent[],
  runId: string,
  decisionId: string | undefined,
) {
  if (!decisionId) return undefined;
  return projectOperatorDecisions(events, runId).find(
    (decision) => decision.id === decisionId && decision.status === "pending",
  );
}

function assertWaitingDecision(
  status: Exclude<RunStatus, "queued" | "running">,
  decisionId: string | undefined,
  decision: ReturnType<typeof findWaitingDecision>,
): void {
  if (decisionId && (status !== "completed" || !decision)) {
    throw new Error("Run cannot wait without its pending operator decision");
  }
}

function settleRunRecord(
  run: StorePersistedRunRecord,
  status: Exclude<RunStatus, "queued" | "running">,
  options: FinishRunOptions,
): void {
  applyOutcome(run, status, options.outcome);
  run.finishedAt = nowIso();
  if (options.error) run.error = options.error;
  if (options.usage) run.usage = structuredClone(options.usage);
  delete run.lease;
  delete run.leaseTokenSha256;
}

function activeRunsAfter(
  state: StoreRepositoryState,
  thread: ThreadRecord,
  finishedRunId: string,
): StorePersistedRunRecord[] {
  const runOrder = new Map(thread.runIds.map((runId, index) => [runId, index]));
  return state.runs
    .filter(
      (run) =>
        run.threadId === thread.id &&
        run.id !== finishedRunId &&
        (run.status === "queued" || run.status === "running"),
    )
    .sort(
      (left, right) =>
        left.startedAt.localeCompare(right.startedAt) ||
        (runOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (runOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
}

function replaceCurrentRun(
  thread: ThreadRecord,
  finishedRunId: string,
  remainingActiveRuns: StorePersistedRunRecord[],
): void {
  if (thread.currentRunId !== finishedRunId) return;
  const replacement = remainingActiveRuns[0];
  if (replacement) thread.currentRunId = replacement.id;
  else delete thread.currentRunId;
}

function assertRunLease(
  run: StorePersistedRunRecord,
  token: string | undefined,
): void {
  if (!run.leaseTokenSha256) return;
  if (!token) throw new Error("Lease token is required");
  const expected = Buffer.from(run.leaseTokenSha256, "hex");
  const actual = Buffer.from(sha256(token), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Lease token is invalid");
  }
}

function stripRunSecrets(run: StorePersistedRunRecord): RunRecord {
  const output = structuredClone(run);
  delete output.leaseTokenSha256;
  return output;
}
