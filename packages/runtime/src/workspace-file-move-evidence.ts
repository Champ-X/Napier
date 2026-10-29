import type { JsonObject, RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { toolOperationLedgerState, type ToolOperationLedgerState } from "./tool-operation-ledger-support.js";
import { validToolOperationEventPayload } from "./tool-operation-event-validation.js";
import { completeHistory, field, moveCommitPayload, moveStartForBoundary, preparedMoveForBoundary,
  type MovePreparationReceipt } from "./workspace-file-move-preparation.js";

export interface MoveRecoveryEvidence {
  callId: string;
  operationId: string;
  startedSeq: number;
  evidenceSeq: number;
  prepared: RunEvent & { payload: MovePreparationReceipt };
  status: "completed" | "not_executed";
  reason: "move_settled" | "move_reconciled" | "move_not_committed";
}

export function moveCommitState(events: RunEvent[], prepared: RunEvent & { payload: MovePreparationReceipt }): "absent" | "entered" | "invalid" {
  const commits = moveCommits(events, prepared);
  if (!commits.length) return "absent";
  return commits.length === 1 && commits[0]!.runId === prepared.runId && commits[0]!.threadId === prepared.threadId &&
    commits[0]!.seq > prepared.seq && canonicalJson(commits[0]!.payload) === canonicalJson(moveCommitPayload(prepared))
    ? "entered" : "invalid";
}

function moveCommits(events: RunEvent[], prepared: RunEvent & { payload: MovePreparationReceipt }): RunEvent[] {
  return events.filter((e) => e.type === "workspace.file.move.commit_started" &&
    (field(e, "callId") === prepared.payload.callId || field(e, "operationId") === prepared.payload.operationId));
}

export function moveReconciliationPayload(prepared: RunEvent & { payload: MovePreparationReceipt }, committed: boolean): JsonObject {
  const content = { schemaVersion: 1, status: committed ? "postcondition_confirmed" : "commit_not_entered",
    callId: prepared.payload.callId, operationId: prepared.payload.operationId,
    effectBoundaryEventSeq: prepared.payload.boundaryEventSeq, preparedEventSeq: prepared.seq,
    preparedSha256: prepared.payload.contentSha256 };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

/** Pure binding used by the SQLite authority fence and historical projection. */
export function moveProofForBoundary(events: RunEvent[], boundary: RunEvent): RunEvent | undefined {
  const prepared = preparedMoveForBoundary(events, boundary);
  if (!prepared) return undefined;
  const state = moveCommitState(events, prepared);
  if (state === "invalid") return undefined;
  const type = state === "entered" ? "workspace.file.move.reconciled" : "workspace.file.move.not_committed";
  const proofs = events.filter((e) => ["workspace.file.move.reconciled", "workspace.file.move.not_committed"].includes(e.type) &&
    (field(e, "operationId") === prepared.payload.operationId || field(e, "callId") === prepared.payload.callId));
  const proof = proofs[0];
  return proofs.length === 1 && proof?.type === type && proof.runId === boundary.runId && proof.threadId === boundary.threadId &&
    proof.seq > (moveCommits(events, prepared)[0]?.seq ?? prepared.seq) &&
    canonicalJson(proof.payload) === canonicalJson(moveReconciliationPayload(prepared, state === "entered")) ? proof : undefined;
}

/** Historical facts only; every continuation must re-open private intent and paths. */
export function moveRecoveryEvidence(events: RunEvent[]): MoveRecoveryEvidence[] {
  if (!completeHistory(events)) return [];
  const results: MoveRecoveryEvidence[] = [];
  for (const prepared of events) {
    if (prepared.type !== "workspace.file.move.prepared") continue;
    const boundary = events.find((e) => e.seq === field(prepared, "boundaryEventSeq") && e.runId === prepared.runId);
    if (!boundary) continue;
    const bound = preparedMoveForBoundary(events, boundary), start = moveStartForBoundary(events, boundary);
    if (!bound || !start) continue;
    const operation = toolOperationLedgerState(events, bound.payload.operationId);
    const terminals = events.filter((e) => ["tool.completed", "tool.failed"].includes(e.type) && e.runId === bound.runId &&
      e.threadId === bound.threadId && field(e, "callId") === bound.payload.callId);
    const base = { callId: bound.payload.callId, operationId: bound.payload.operationId, startedSeq: start.seq, prepared: bound };
    const settled = settledMoveProof(events, boundary, bound, operation, terminals);
    if (settled) {
      results.push({ ...base, status: "completed", reason: "move_settled", evidenceSeq: settled.seq });
      continue;
    }
    const proof = reconciledMoveProof(events, boundary, bound, operation, terminals);
    if (!proof) continue;
    const committed = proof.type === "workspace.file.move.reconciled";
    results.push({ ...base, status: committed ? "completed" : "not_executed",
      reason: committed ? "move_reconciled" : "move_not_committed", evidenceSeq: proof.seq });
  }
  // Independent histories can coexist. A shared endpoint requires an explicit
  // version chain, outside this scope; private paths/inodes are rechecked later.
  const paths = results.flatMap((value) => [value.prepared.payload.sourcePathSha256, value.prepared.payload.destinationPathSha256]);
  return results.length <= 128 && new Set(paths).size === paths.length ? results : [];
}

function settledMoveProof(events: RunEvent[], boundary: RunEvent,
  prepared: RunEvent & { payload: MovePreparationReceipt }, operation: ToolOperationLedgerState,
  terminals: RunEvent[]): RunEvent | undefined {
  if (operation.settled && !operation.effectIndeterminate && field(operation.settled, "outcome") === "succeeded" &&
      moveCommitState(events, prepared) === "entered" && operation.settled.seq > moveCommits(events, prepared)[0]!.seq &&
      validToolOperationEventPayload("tool.operation.settled", operation.settled.payload) &&
      field(operation.settled, "descriptorSha256") === field(boundary, "descriptorSha256") &&
      (terminals.length === 0 || (terminals.length === 1 && terminals[0]!.type === "tool.completed" &&
        terminals[0]!.seq > operation.settled.seq && field(terminals[0], "toolName") === "workspace_file_apply"))) {
    return operation.settled;
  }
  return undefined;
}

function reconciledMoveProof(events: RunEvent[], boundary: RunEvent,
  prepared: RunEvent & { payload: MovePreparationReceipt }, operation: ToolOperationLedgerState,
  terminals: RunEvent[]): RunEvent | undefined {
  const marker = operation.effectIndeterminate;
  if (!marker || operation.settled || terminals.length || !validToolOperationEventPayload("tool.operation.effect_indeterminate", marker.payload) ||
      field(marker, "effectBoundaryEventSeq") !== boundary.seq || field(marker, "descriptorSha256") !== field(boundary, "descriptorSha256")) return undefined;
  const proof = moveProofForBoundary(events, boundary);
  const ends = events.filter((e) => e.runId === prepared.runId && ["run.completed", "run.failed", "run.cancelled", "run.interrupted"].includes(e.type));
  const end = ends[0], ids = field(end, "operationIds");
  const expected = events.filter((e) => e.runId === prepared.runId && e.type === "tool.operation.effect_indeterminate").map((e) => field(e, "operationId")).sort();
  if (!proof || proof.seq <= marker.seq || ends.length !== 1 || end?.type !== "run.interrupted" || end.seq <= proof.seq ||
      field(end, "status") !== "interrupted" || field(end, "reason") !== "operation_postcondition_reconciled" ||
      !Array.isArray(ids) || canonicalJson([...ids].sort()) !== canonicalJson(expected)) return undefined;
  return proof;
}
