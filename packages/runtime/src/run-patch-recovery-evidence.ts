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

export interface SettledPatchRecoveryCandidate {
  callId: string;
  startedSeq: number;
  settledSeq: number;
  operationId: string;
  inputSha256: string;
  effectSha256: string;
  terminal?: SettledPatchRecoveryEvidence;
}

/** Eligibility to inspect postconditions, not a claim about current files. */
export function settledPatchRecoveryCandidates(
  events: RunEvent[],
): SettledPatchRecoveryCandidate[] {
  if (events.length > 10_000) return [];
  const operations = [...toolExecutionAuthorityOperationIds(events)].map(
    (id) => ({
      id,
      state: toolOperationLedgerState(events, id),
    }),
  );
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
    if (terminals.length > 1) return [];
    const matching = operations.filter(
      ({ state }) =>
        state.proposed?.runId === started.runId &&
        record(state.proposed?.payload)?.["parentCallId"] === callId,
    );
    if (matching.length !== 1) return [];
    const operation = matching[0]!;
    if (!validSettledPatchOperation(operation.state)) return [];
    const settled = operation.state.settled!;
    if (settled.seq <= started.seq) return [];
    const candidate: SettledPatchRecoveryCandidate = {
      callId,
      startedSeq: started.seq,
      settledSeq: settled.seq,
      operationId: operation.id,
      inputSha256: start["inputSha256"],
      effectSha256: String(record(settled.payload)?.["effectSha256"]),
    };
    const terminal = terminals[0];
    if (!terminal) return [candidate];
    const payload = record(terminal.payload);
    if (
      terminal.type !== "tool.completed" ||
      terminal.seq <= settled.seq ||
      payload?.["toolName"] !== "apply_patch"
    )
      return [];
    const evidence = patchRecoveryEvidenceFromDetails(
      candidate,
      payload["details"],
      terminal.seq,
    );
    return evidence ? [{ ...candidate, terminal: evidence }] : [];
  });
}

function validSettledPatchOperation(
  state: ReturnType<typeof toolOperationLedgerState>,
): boolean {
  if (
    !state.proposed ||
    !state.admitted ||
    !state.started ||
    !state.effectBoundary ||
    !state.settled ||
    state.effectIndeterminate ||
    state.admission !== "admitted" ||
    record(state.settled.payload)?.["outcome"] !== "succeeded" ||
    state.settled.seq <= state.effectBoundary.seq
  )
    return false;
  const phases = [
    state.proposed,
    state.admitted,
    state.started,
    state.effectBoundary,
    state.settled,
  ];
  return phases.every(
    (event) =>
      record(event.payload)?.["route"] === "apply_patch" &&
      record(event.payload)?.["descriptorSha256"] ===
        record(state.proposed?.payload)?.["descriptorSha256"] &&
      validToolOperationEventPayload(
        event.type as "tool.operation.started",
        event.payload,
      ),
  );
}

export function patchRecoveryEvidenceFromDetails(
  candidate: SettledPatchRecoveryCandidate,
  value: unknown,
  completedSeq = candidate.settledSeq,
): SettledPatchRecoveryEvidence | undefined {
  const details = record(value);
  if (!validDetails(details)) return undefined;
  return {
    callId: candidate.callId,
    startedSeq: candidate.startedSeq,
    completedSeq,
    operationId: candidate.operationId,
    inputSha256: candidate.inputSha256,
    capsuleSha256: details.recoveryCapsuleSha256,
    pathSha256: details.pathSha256,
    beforeSha256: details.beforeSha256,
    afterSha256: details.afterSha256,
  };
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
