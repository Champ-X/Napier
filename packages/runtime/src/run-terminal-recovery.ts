import type {
  RunEvent,
  RunRecord,
  ThreadRecord,
} from "@napier/contracts";

import { projectOperatorDecisions } from "./operator-decisions.js";
import {
  cancelPendingOperatorDecisions,
  cancelPendingRunControlMessages,
  operatorDecisionCancellationReason,
  runControlMessageCancellationReason,
  type RunLifecycleCancellationHost,
} from "./run-lifecycle-cancellation.js";
import {
  RUN_TERMINAL_EVENT_TYPES,
  terminalRunStatusFromEventType,
  type TerminalRunStatus,
} from "./run-event-admission.js";
import { settleThread } from "./run-outcomes.js";
import { transitionRunStatus } from "./run-state-machine.js";

interface TerminalRecoveryRun extends RunRecord {
  leaseTokenSha256?: string;
}

interface RunTerminalRecoveryHost extends RunLifecycleCancellationHost {
  state: {
    runs: TerminalRecoveryRun[];
    threads: ThreadRecord[];
  };
  requireLedger(): {
    listEvents(threadId: string, afterSeq?: number): RunEvent[];
    listRunEvents(
      runId: string,
      afterSeq?: number,
      types?: readonly string[],
    ): RunEvent[];
  };
  mutableRun(runId: string): TerminalRecoveryRun;
  mutableThread(threadId: string): ThreadRecord;
}

interface DurableTerminalRepair {
  event: RunEvent;
  status: TerminalRunStatus;
}

export const RUN_INTERRUPTION_REASON =
  "The runtime process exited or its renewable owner lease expired before this run reached a terminal state.";

export function repairRunsFromTerminalEvidence(
  host: RunTerminalRecoveryHost,
): Map<string, DurableTerminalRepair> {
  const repaired = new Map<string, DurableTerminalRepair>();
  for (const run of host.state.runs) {
    if (run.status !== "queued" && run.status !== "running") continue;
    const event = host
      .requireLedger()
      .listRunEvents(run.id, 0, RUN_TERMINAL_EVENT_TYPES)
      .find((candidate) => candidate.threadId === run.threadId);
    const status = event
      ? terminalRunStatusFromEventType(event.type)
      : undefined;
    if (!event || !status) continue;
    transitionRunStatus(run, status);
    run.finishedAt = event.createdAt;
    const payload = jsonRecord(event.payload);
    const message = payload && stringValue(payload["message"]);
    const outcome = payload && terminalOutcome(status, payload["outcome"]);
    if (outcome) run.outcome = outcome;
    if (message && status !== "completed") run.error = message;
    if (status === "interrupted") {
      run.interruptedAt = event.createdAt;
      run.interruptionReason =
        (payload && stringValue(payload["reason"])) ?? RUN_INTERRUPTION_REASON;
    }
    delete run.lease;
    delete run.leaseTokenSha256;
    repaired.set(run.id, { event, status });
  }
  return repaired;
}

export function cancelTerminalRunInteractions(
  host: RunTerminalRecoveryHost,
  terminalStatuses: ReadonlyMap<string, TerminalRunStatus>,
): RunEvent[] {
  const events: RunEvent[] = [];
  for (const [runId, status] of terminalStatuses) {
    const run = host.mutableRun(runId);
    const thread = host.mutableThread(run.threadId);
    const preservedDecisionId =
      status === "completed"
        ? waitingDecisionId(host, runId, thread.id)
        : undefined;
    events.push(
      ...cancelPendingRunControlMessages(
        host,
        thread,
        run.id,
        runControlMessageCancellationReason(status),
      ),
      ...(status === "interrupted"
        ? []
        : cancelPendingOperatorDecisions(
            host,
            thread,
            run.id,
            operatorDecisionCancellationReason(status),
            preservedDecisionId,
          )),
    );
  }
  return events;
}

export function resetTerminalThreads(
  host: RunTerminalRecoveryHost,
  terminalStatuses: ReadonlyMap<string, TerminalRunStatus>,
  cancellationEvents: readonly RunEvent[],
  timestamp: string,
): boolean {
  let changed = false;
  for (const thread of host.state.threads) {
    const repairedRunIds = thread.runIds.filter((runId) =>
      terminalStatuses.has(runId),
    );
    if (repairedRunIds.length === 0) continue;
    const activeRuns = host.state.runs
      .filter(
        (run) =>
          run.threadId === thread.id &&
          (run.status === "queued" || run.status === "running"),
      )
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    if (thread.currentRunId && terminalStatuses.has(thread.currentRunId)) {
      const replacement = activeRuns[0];
      if (replacement) thread.currentRunId = replacement.id;
      else delete thread.currentRunId;
    }
    const latestRepairedRun = host.state.runs
      .filter((run) => repairedRunIds.includes(run.id))
      .sort((left, right) =>
        (right.finishedAt ?? "").localeCompare(left.finishedAt ?? ""),
      )[0];
    if (!latestRepairedRun) continue;
    const events = [
      ...host.requireLedger().listEvents(thread.id),
      ...cancellationEvents.filter((event) => event.threadId === thread.id),
    ];
    const hasOpenDecision = projectOperatorDecisions(events).some(
      (decision) =>
        decision.status === "pending" || decision.status === "answered",
    );
    thread.status = settleThread(
      latestRepairedRun.status as TerminalRunStatus,
      latestRepairedRun.outcome,
      activeRuns.length > 0,
      hasOpenDecision,
    );
    thread.updatedAt = timestamp;
    changed = true;
  }
  return changed;
}

function waitingDecisionId(
  host: RunTerminalRecoveryHost,
  runId: string,
  threadId: string,
): string | undefined {
  const events = host.requireLedger().listEvents(threadId);
  const waiting = [...events]
    .reverse()
    .find(
      (event) =>
        event.runId === runId && event.type === "run.waiting_for_operator",
    );
  const payload = waiting ? jsonRecord(waiting.payload) : undefined;
  const decisionId = payload && stringValue(payload["operatorDecisionId"]);
  if (!decisionId) return undefined;
  return projectOperatorDecisions(events, runId).some(
    (decision) => decision.id === decisionId && decision.status === "pending",
  )
    ? decisionId
    : undefined;
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function terminalOutcome(
  status: TerminalRunStatus,
  value: unknown,
): NonNullable<RunRecord["outcome"]> | undefined {
  if (status === "completed" && value === "completed") return value;
  if (status === "cancelled" && value === "cancelled") return value;
  if (
    status === "failed" &&
    (value === "partial" ||
      value === "paused_budget" ||
      value === "blocked_capability" ||
      value === "blocked_safety" ||
      value === "failed_unrecoverable")
  ) {
    return value;
  }
  return undefined;
}
