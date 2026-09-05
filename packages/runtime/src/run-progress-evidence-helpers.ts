import type { JsonValue, RunEvent } from "@napier/contracts";

import { progressText } from "./run-progress-ledger-projection.js";
import type { SettledToolOperationProgressObservation } from "./tool-operation-journal.js";

export function childObservation(
  payload: Record<string, JsonValue> | undefined,
  observations: Map<string, SettledToolOperationProgressObservation>,
): SettledToolOperationProgressObservation | undefined {
  const operationId = progressText(payload?.["operationId"]);
  return operationId ? observations.get(operationId) : undefined;
}

export function parentTerminalSuppressed(
  event: Pick<RunEvent, "seq">,
  payload: Record<string, JsonValue> | undefined,
  observations: readonly SettledToolOperationProgressObservation[],
): boolean {
  const callId = progressText(payload?.["callId"]);
  return Boolean(
    callId &&
    observations.some(
      (observation) =>
        observation.parentCallId === callId &&
        observation.settledEventSeq < event.seq,
    ),
  );
}

export function childProgressPayload(
  observation: SettledToolOperationProgressObservation,
): Record<string, JsonValue> {
  return {
    callId: observation.operationId,
    toolProtocol: {
      progress: {
        ...observation.progress,
        stateSha256:
          observation.progress.stateSha256 ?? observation.effectSha256,
      },
    },
  } as unknown as Record<string, JsonValue>;
}

export function runEventObservationId(
  event: Pick<RunEvent, "seq" | "type">,
): string {
  return `run-event:${String(event.seq)}:${event.type}`;
}
