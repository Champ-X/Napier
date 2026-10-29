import type { JsonObject, RunEvent } from "@napier/contracts";
import { toolOperationLedgerState } from "./tool-operation-ledger-support.js";
import { validToolOperationEventPayload } from "./tool-operation-event-validation.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  patchEventPayload,
  preparedPatchForBoundary,
  type PatchPreparationReceipt,
} from "./workspace-patch-preparation.js";
import type { SettledPatchRecoveryEvidence } from "./run-patch-recovery-evidence.js";
import { operationReconciliationReason } from "./workspace-operation-recovery-scope.js";

export function patchReconciliationPayload(
  prepared: RunEvent & { payload: PatchPreparationReceipt },
): JsonObject {
  const content = {
    schemaVersion: 1,
    status: "postcondition_confirmed",
    callId: prepared.payload.callId,
    operationId: prepared.payload.operationId,
    effectBoundaryEventSeq: prepared.payload.boundaryEventSeq,
    preparedEventSeq: prepared.seq,
    preparedSha256: prepared.payload.contentSha256,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

/** Pure journal binding shared by the SQLite transition guard and replay. */
export function reconciledPatchForBoundary(
  events: RunEvent[],
  boundary: RunEvent,
): SettledPatchRecoveryEvidence | undefined {
  const prepared = preparedPatchForBoundary(events, boundary);
  if (!prepared) return undefined;
  const candidates = events.filter(
    (event) =>
      event.type === "workspace.patch.reconciled" &&
      event.runId === boundary.runId &&
      patchEventPayload(event)["operationId"] ===
        patchEventPayload(boundary)["operationId"],
  );
  const reconciled = candidates[0];
  if (
    candidates.length !== 1 ||
    !reconciled ||
    reconciled.seq <= prepared.seq ||
    canonicalJson(reconciled.payload) !==
      canonicalJson(patchReconciliationPayload(prepared))
  )
    return undefined;
  return {
    callId: prepared.payload.callId,
    operationId: prepared.payload.operationId,
    startedSeq: events.find(
      (e) =>
        e.type === "tool.started" &&
        e.runId === boundary.runId &&
        patchEventPayload(e)["callId"] === prepared.payload.callId,
    )!.seq,
    completedSeq: reconciled.seq,
    inputSha256: prepared.payload.inputSha256,
    capsuleSha256: prepared.payload.recoveryCapsuleSha256,
    pathSha256: prepared.payload.pathSha256,
    beforeSha256: prepared.payload.beforeSha256,
    afterSha256: prepared.payload.afterSha256,
    preparedCapsuleSha256: prepared.payload.capsuleSha256,
  };
}

export function reconciledPatchRecoveryEvidence(
  events: RunEvent[],
): SettledPatchRecoveryEvidence[] {
  if (events.length > 10_000) return [];
  return events.flatMap((marker) => {
    if (marker.type !== "tool.operation.effect_indeterminate") return [];
    const boundary = events.find(
      (e) =>
        e.seq === patchEventPayload(marker)["effectBoundaryEventSeq"] &&
        e.runId === marker.runId,
    );
    if (
      !boundary ||
      !validToolOperationEventPayload(
        "tool.operation.effect_indeterminate",
        marker.payload,
      )
    )
      return [];
    const operationId = patchEventPayload(marker)["operationId"];
    if (typeof operationId !== "string") return [];
    const state = toolOperationLedgerState(events, operationId);
    if (
      state.settled ||
      state.effectIndeterminate?.seq !== marker.seq ||
      events.some(
        (e) =>
          e.runId === marker.runId &&
          ["tool.completed", "tool.failed"].includes(e.type) &&
          patchEventPayload(e)["callId"] ===
            patchEventPayload(marker)["parentCallId"],
      )
    )
      return [];
    const patch = reconciledPatchForBoundary(events, boundary);
    const terminal = reconciliationTerminal(events, marker);
    return patch &&
      patch.completedSeq > marker.seq &&
      terminal &&
      terminal.seq > patch.completedSeq
      ? [patch]
      : [];
  });
}

function reconciliationTerminal(
  events: RunEvent[],
  marker: RunEvent,
): RunEvent | undefined {
  const terminals = events.filter(
    (event) =>
      event.runId === marker.runId &&
      [
        "run.completed",
        "run.failed",
        "run.cancelled",
        "run.interrupted",
      ].includes(event.type),
  );
  const terminal = terminals[0];
  const payload = patchEventPayload(terminal);
  const expected = events
    .filter(
      (event) =>
        event.runId === marker.runId &&
        event.type === "tool.operation.effect_indeterminate",
    )
    .map((event) => patchEventPayload(event)["operationId"])
    .sort();
  return terminals.length === 1 &&
    terminal?.type === "run.interrupted" &&
    payload["status"] === "interrupted" &&
    payload["reason"] === operationReconciliationReason(events.filter((event) =>
      event.runId === marker.runId && event.type === "tool.operation.effect_indeterminate")) &&
    Array.isArray(payload["operationIds"]) &&
    canonicalJson([...payload["operationIds"]].sort()) ===
      canonicalJson(expected)
    ? terminal
    : undefined;
}
