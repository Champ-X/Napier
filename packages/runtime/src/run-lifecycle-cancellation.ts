import type {
  OperatorDecisionCancellationReason,
  RunControlMessageCancellationReason,
  RunEvent,
  RunStatus,
  ThreadRecord,
} from "@napier/contracts";

import {
  createOperatorDecisionCancelledPayload,
  projectOperatorDecisions,
} from "./operator-decisions.js";
import {
  createRunControlMessageCancelledPayload,
  projectRunControlMessages,
} from "./run-control-messages.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";

export function cancelPendingRunControlMessages(
  host: StoreRepositoryHost,
  thread: ThreadRecord,
  runId: string,
  reason: RunControlMessageCancellationReason,
): RunEvent[] {
  const currentEvents = host.requireLedger().listEvents(thread.id);
  const pending = projectRunControlMessages(currentEvents, runId).filter(
    (message) => message.status === "queued",
  );
  return host.appendEventsToThread(
    thread,
    pending.map((message) => ({
      threadId: thread.id,
      runId,
      type: "run.control.cancelled",
      category: "message",
      visibility: "user",
      payload: createRunControlMessageCancelledPayload({ message, reason }),
    })),
  );
}

export function cancelPendingOperatorDecisions(
  host: StoreRepositoryHost,
  thread: ThreadRecord,
  runId: string,
  reason: OperatorDecisionCancellationReason,
  preservedDecisionId?: string,
): RunEvent[] {
  const currentEvents = host.requireLedger().listEvents(thread.id);
  const pending = projectOperatorDecisions(currentEvents, runId).filter(
    (decision) =>
      decision.status === "pending" && decision.id !== preservedDecisionId,
  );
  return host.appendEventsToThread(
    thread,
    pending.map((decision) => ({
      threadId: thread.id,
      runId,
      type: "operator.decision.cancelled",
      category: "system",
      visibility: "user",
      payload: createOperatorDecisionCancelledPayload({ decision, reason }),
    })),
  );
}

export function runControlMessageCancellationReason(
  status: Exclude<RunStatus, "queued" | "running">,
): RunControlMessageCancellationReason {
  if (status === "completed") return "run_completed_before_delivery";
  if (status === "cancelled") return "run_cancelled_before_delivery";
  if (status === "interrupted") return "run_interrupted_before_delivery";
  return "run_failed_before_delivery";
}

export function operatorDecisionCancellationReason(
  status: Exclude<RunStatus, "queued" | "running">,
): OperatorDecisionCancellationReason {
  if (status === "completed") return "run_completed_without_wait";
  if (status === "cancelled") return "run_cancelled";
  return "run_failed";
}
