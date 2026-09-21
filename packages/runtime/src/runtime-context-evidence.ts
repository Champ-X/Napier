import type { ContextProjectionReceiptV1, RunEvent } from "@napier/contracts";
import { contextEvidenceRecord } from "./run-context-checkpoint.js";
import type { ModelInvocationCapsule } from "./model-invocation-capsule.js";
import {
  RUNTIME_CONTEXT_EVENT,
  validateRuntimeContextReceipt,
  type RuntimeContextReceipt,
  assertRuntimeContextCapsule,
} from "./runtime-context-receipt.js";

export function assertRuntimeContextInvocation(
  events: readonly RunEvent[],
  capsule: ModelInvocationCapsule,
): void {
  if (capsule.purpose !== "agent_turn") return;
  const envelope = events.find(
    (event) =>
      event.runId === capsule.sourceRunId &&
      event.type === "context.model_envelope" &&
      contextEvidenceRecord(event.payload)["contentSha256"] ===
        capsule.contextEnvelopeSha256,
  );
  if (!envelope) throw invalid();
  const projection = events
    .filter(
      (event) =>
        event.runId === capsule.sourceRunId &&
        event.seq < envelope.seq &&
        event.type === "context.projected",
    )
    .at(-1);
  if (!projection) return;
  const delivery = boundRuntimeContextReceipt(events, projection);
  if (delivery) assertRuntimeContextCapsule(delivery, capsule.context);
}

export function boundRuntimeContextReceipt(
  events: readonly RunEvent[],
  event: RunEvent,
): RuntimeContextReceipt | undefined {
  const binding = contextEvidenceRecord(event.payload)[
    "runtimeContextReceiptSha256"
  ];
  if (binding === undefined) return undefined;
  const matches = events.filter(
    (candidate) =>
      candidate.runId === event.runId &&
      candidate.seq < event.seq &&
      candidate.type === RUNTIME_CONTEXT_EVENT &&
      contextEvidenceRecord(candidate.payload)["contentSha256"] === binding,
  );
  if (matches.length !== 1) throw invalid();
  return validateRuntimeContextReceipt(matches[0]!.payload);
}

export function assertRuntimeContextBinding(
  events: readonly RunEvent[],
  event: RunEvent,
  receipt: ContextProjectionReceiptV1,
  pressure: RunEvent | undefined,
): RuntimeContextReceipt | undefined {
  const stages = events.filter(
    (candidate) =>
      candidate.runId === event.runId &&
      candidate.type === RUNTIME_CONTEXT_EVENT &&
      candidate.seq > (pressure?.seq ?? event.seq) &&
      candidate.seq < event.seq,
  );
  const delivery = boundRuntimeContextReceipt(events, event);
  if (!delivery) {
    if (stages.length !== 0) throw invalid();
    return undefined;
  }
  if (
    !pressure ||
    stages.length !== 1 ||
    contextEvidenceRecord(stages[0]!.payload)["contentSha256"] !==
      delivery.contentSha256 ||
    delivery.runId !== event.runId ||
    delivery.modelAttempt !== receipt.modelAttempt ||
    delivery.recoveryAttempt !== receipt.recoveryAttempt ||
    delivery.systemPromptSha256 !== receipt.systemPromptSha256 ||
    delivery.tokenPressureReceiptSha256 !==
      receipt.tokenPressureReceiptSha256 ||
    delivery.preparedMessageCount !== receipt.preparedMessageCount ||
    delivery.preparedMessageSetSha256 !== receipt.preparedMessageSetSha256 ||
    delivery.activeMessageCount !== receipt.activeMessageCount ||
    delivery.activeMessageSetSha256 !== receipt.activeMessageSetSha256
  )
    throw invalid();
  return delivery;
}

function invalid(): Error {
  return new Error("Runtime context delivery source binding is invalid");
}
