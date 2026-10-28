import type { RunEvent } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { toolExecutionAuthorityOperationIds } from "./tool-execution-authority-binding.js";
import { toolOperationLedgerState } from "./tool-operation-ledger-support.js";
import { validToolOperationEventPayload } from "./tool-operation-event-validation.js";

export interface SettledPatchRecoveryEvidence {
  callId: string;
  startedSeq: number;
  completedSeq: number;
  operationId: string;
  inputSha256: string;
  capsuleSha256: string;
  pathSha256: string;
  beforeSha256: string | null;
  afterSha256: string;
}

/** Eligibility to inspect postconditions, not a claim about current files. */
export function settledPatchRecoveryEvidence(
  events: RunEvent[],
): SettledPatchRecoveryEvidence[] {
  if (events.length > 10_000) return [];
  const authorities = toolExecutionAuthorityOperationIds(events);
  const operations = [...authorities].map((id) => ({
    id,
    state: toolOperationLedgerState(events, id),
  }));
  return events.flatMap((started) => {
    const start = record(started.payload);
    if (
      started.type !== "tool.started" ||
      start?.["toolName"] !== "apply_patch" ||
      typeof start["callId"] !== "string" ||
      !isHash(start["inputSha256"])
    )
      return [];
    const callId = start["callId"];
    const related = events.filter(
      (event) =>
        event.runId === started.runId &&
        record(event.payload)?.["callId"] === callId,
    );
    if (related.filter((event) => event.type === "tool.started").length !== 1)
      return [];
    const terminals = related.filter(
      (event) =>
        event.type === "tool.completed" || event.type === "tool.failed",
    );
    const terminal = terminals.length === 1 ? terminals[0] : undefined;
    const payload = record(terminal?.payload);
    const details = record(payload?.["details"]);
    if (
      !terminal ||
      terminal.type !== "tool.completed" ||
      terminal.seq <= started.seq ||
      payload?.["toolName"] !== "apply_patch" ||
      !validDetails(details)
    )
      return [];
    const matchingOperations = operations.filter(
      ({ state }) =>
        state.proposed?.runId === started.runId &&
        record(state.proposed?.payload)?.["parentCallId"] === callId,
    );
    if (matchingOperations.length !== 1) return [];
    const operation = matchingOperations[0]!;
    const state = operation.state;
    if (
      !state.started ||
      !state.effectBoundary ||
      !state.settled ||
      state.effectIndeterminate ||
      state.admission !== "admitted" ||
      record(state.settled.payload)?.["outcome"] !== "succeeded" ||
      state.settled.seq <= state.effectBoundary.seq ||
      state.settled.seq >= terminal.seq
    )
      return [];
    const phases = [
      state.proposed!,
      state.admitted!,
      state.started,
      state.effectBoundary,
      state.settled,
    ];
    if (
      phases.some(
        (event) =>
          record(event.payload)?.["route"] !== "apply_patch" ||
          record(event.payload)?.["descriptorSha256"] !==
            record(state.proposed?.payload)?.["descriptorSha256"] ||
          !validToolOperationEventPayload(
            event.type as "tool.operation.started",
            event.payload,
          ),
      )
    )
      return [];
    return [
      {
        callId,
        startedSeq: started.seq,
        completedSeq: terminal.seq,
        operationId: operation.id,
        inputSha256: start["inputSha256"],
        capsuleSha256: details.recoveryCapsuleSha256,
        pathSha256: details.pathSha256,
        beforeSha256: details.beforeSha256,
        afterSha256: details.afterSha256,
      },
    ];
  });
}

interface PatchDetails extends Record<string, unknown> {
  recoveryCapsuleSha256: string;
  pathSha256: string;
  beforeSha256: string | null;
  afterSha256: string;
}

function validDetails(
  details: Record<string, unknown> | undefined,
): details is PatchDetails {
  if (
    !details ||
    details["kind"] !== "napier.workspace-patch" ||
    details["schemaVersion"] !== 1
  )
    return false;
  const { resultSha256, ...content } = details;
  return (
    [
      resultSha256,
      details["recoveryCapsuleSha256"],
      details["pathSha256"],
      details["afterSha256"],
    ].every(isHash) &&
    (details["beforeSha256"] === null || isHash(details["beforeSha256"])) &&
    sha256(canonicalJson(content)) === resultSha256
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
