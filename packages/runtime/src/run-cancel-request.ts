import type { JsonObject, RunEvent } from "@napier/contracts";
import type { AppendEventInput } from "./run-event-registry.js";

export const RUN_CANCEL_REQUESTED_EVENT = "run.cancel.requested" as const;

export interface RunCancelRequestPayload extends JsonObject {
  kind: "napier.run-cancel-request";
  schemaVersion: 1;
  reason: "operator_stop" | "parent_abort" | "budget_timeout" | "system";
  requestedAt: string;
}

export function createRunCancelRequestPayload(
  reason: RunCancelRequestPayload["reason"],
  requestedAt = new Date().toISOString(),
): RunCancelRequestPayload {
  return {
    kind: "napier.run-cancel-request",
    schemaVersion: 1,
    reason,
    requestedAt,
  };
}

export function runCancelRequestAppendInput(input: {
  threadId: string;
  runId: string;
  reason: RunCancelRequestPayload["reason"];
  requestedAt?: string;
}): AppendEventInput {
  return {
    threadId: input.threadId,
    runId: input.runId,
    type: RUN_CANCEL_REQUESTED_EVENT,
    category: "lifecycle",
    visibility: "user",
    payload: createRunCancelRequestPayload(
      input.reason,
      input.requestedAt ?? new Date().toISOString(),
    ),
  };
}

/** Durable cancel intent is present before or without a terminal run.cancelled. */
export function hasDurableRunCancelRequest(
  events: readonly RunEvent[],
  runId: string,
): boolean {
  return events.some(
    (event) =>
      event.runId === runId &&
      (event.type === RUN_CANCEL_REQUESTED_EVENT ||
        event.type === "run.cancelled"),
  );
}
