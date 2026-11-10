import type { RunEvent, RunRecord } from "@napier/contracts";
import type {
  RecoveryOperationReason,
  RecoveryOperationStatus,
} from "@napier/contracts/manual-run-recovery";
import type {
  RunToolRecoveryEligibilityTableV1,
  ToolOperationFencePhaseV1,
  ToolOperationRecoveryRowV1,
} from "@napier/contracts/tool-operation-recovery-eligibility";
import type { ToolReplayClassV1 } from "@napier/contracts/tool-replay-class";
import type { ToolSideEffect } from "@napier/contracts/tool-protocol";
import {
  collectRunToolEffectObservations,
  normalizeToolName,
} from "./run-tool-effect-observations.js";
import { settledPatchRecoveryCandidates } from "./run-patch-recovery-evidence.js";
import { reconciledPatchRecoveryEvidence } from "./workspace-patch-reconciled-evidence.js";
import { uncommittedPatchCandidates } from "./workspace-patch-uncommitted-evidence.js";
import { moveRecoveryEvidence } from "./workspace-file-move-evidence.js";
import {
  toolOperationLedgerState,
  type ToolOperationLedgerState,
} from "./tool-operation-ledger-support.js";
import { resolveToolReplayClass } from "./tool-replay-eligibility.js";
import { isSubagentChildRun } from "./primary-run-selection.js";

const LIMIT = 10_000;

type Proof = {
  status: RecoveryOperationStatus;
  reason: RecoveryOperationReason;
  evidenceSeq: number;
};

/**
 * Project the Run-wide recovery eligibility table from tool starts plus
 * tool.operation intent/effect/settlement fences (Pi Durable two-commit shape).
 */
export function projectRunToolRecoveryEligibilityTable(
  run: RunRecord,
  source: RunEvent[],
): RunToolRecoveryEligibilityTableV1 | undefined {
  if (isSubagentChildRun(run)) return undefined;
  const events = source
    .filter((event) => event.runId === run.id && event.threadId === run.threadId)
    .sort((a, b) => a.seq - b.seq);
  const starts = events.filter((event) => event.type === "tool.started");
  const evidenceLimited =
    events.length > LIMIT ||
    new Set(events.map((event) => event.seq)).size !== events.length ||
    new Set(events.map((event) => event.id)).size !== events.length;
  const base: RunToolRecoveryEligibilityTableV1 = {
    kind: "napier.run-tool-recovery-eligibility",
    schemaVersion: 1,
    threadId: run.threadId,
    runId: run.id,
    revisedAtSeq: events.at(-1)?.seq ?? 0,
    evidenceLimited,
    rows: [],
  };
  if (evidenceLimited) return base;

  const proofs = patchProofs(events);
  const observations = collectRunToolEffectObservations(events);
  const journals = primaryJournalsByCall(events);
  const calls = new Map<string, RunEvent[]>();
  for (const event of events) {
    if (!["tool.started", "tool.completed", "tool.failed"].includes(event.type))
      continue;
    const callId = field(event, "callId");
    const bucket = calls.get(callId) ?? [];
    bucket.push(event);
    calls.set(callId, bucket);
  }

  base.rows = starts.map((start, index): ToolOperationRecoveryRowV1 => {
    const callId = field(start, "callId");
    const toolName = normalizeToolName(field(start, "toolName"));
    const related = calls.get(callId) ?? [];
    const journal = journals.get(callId);
    const fencePhase = journal
      ? fencePhaseFromLedger(journal.state)
      : "none";
    const effect = observations[index]?.effect ?? "unknown";
    const replayClass = replayClassForTool(toolName, effect);
    const classified = classifyRow({
      callId,
      toolName,
      startedSeq: start.seq,
      startToolName: field(start, "toolName"),
      related,
      proof: proofs.get(start.seq),
      effect,
      fencePhase,
      replayClass,
    });
    return {
      parentCallId: callId.slice(0, 200),
      toolName,
      startedSeq: start.seq,
      evidenceSeq: classified.evidenceSeq,
      ...(journal ? { operationId: journal.operationId } : {}),
      fencePhase,
      replayClass,
      recoveryStatus: classified.status,
      recoveryReason: classified.reason,
      journalBacked: journal !== undefined && fencePhase !== "none",
    };
  });
  return base;
}

export function fencePhaseFromLedger(
  state: ToolOperationLedgerState,
): ToolOperationFencePhaseV1 {
  if (state.effectIndeterminate) return "indeterminate";
  if (state.settled) return "settled";
  if (state.effectBoundary) return "effect_pending";
  if (state.started) return "started";
  if (state.proposed || state.admitted) return "intent";
  return "none";
}

function primaryJournalsByCall(
  events: readonly RunEvent[],
): Map<string, { operationId: string; state: ToolOperationLedgerState }> {
  const candidates = new Map<
    string,
    { operationIds: Set<string>; authorityId?: string }
  >();
  for (const event of events) {
    if (!event.type.startsWith("tool.operation.")) continue;
    const payload = record(event.payload);
    const parentCallId =
      typeof payload?.["parentCallId"] === "string"
        ? payload["parentCallId"]
        : "";
    if (!parentCallId) continue;
    const operationId =
      typeof payload?.["operationId"] === "string"
        ? payload["operationId"]
        : "";
    if (!operationId) continue;
    const bucket = candidates.get(parentCallId) ?? {
      operationIds: new Set<string>(),
    };
    bucket.operationIds.add(operationId);
    if (payload?.["role"] === "execution_authority") {
      bucket.authorityId = operationId;
    }
    candidates.set(parentCallId, bucket);
  }
  const journals = new Map<
    string,
    { operationId: string; state: ToolOperationLedgerState }
  >();
  for (const [parentCallId, bucket] of candidates) {
    const chosen =
      bucket.authorityId ?? [...bucket.operationIds].sort()[0];
    if (!chosen) continue;
    journals.set(parentCallId, {
      operationId: chosen,
      state: toolOperationLedgerState(events, chosen),
    });
  }
  return journals;
}

function classifyRow(input: {
  callId: string;
  toolName: string;
  startedSeq: number;
  startToolName: string;
  related: RunEvent[];
  proof: Proof | undefined;
  effect: "read" | "write" | "unknown";
  fencePhase: ToolOperationFencePhaseV1;
  replayClass: ToolReplayClassV1;
}): {
  status: RecoveryOperationStatus;
  reason: RecoveryOperationReason;
  evidenceSeq: number;
} {
  if (
    !input.callId ||
    input.related.filter((event) => event.type === "tool.started").length !== 1
  ) {
    return {
      status: "needs_reconciliation",
      reason: "evidence_missing",
      evidenceSeq: input.startedSeq,
    };
  }
  if (input.proof) return input.proof;

  if (input.fencePhase === "intent" || input.fencePhase === "started") {
    return {
      status: "not_executed",
      reason:
        input.toolName === "apply_patch"
          ? "patch_not_committed"
          : "effect_unresolved",
      evidenceSeq: input.startedSeq,
    };
  }
  if (
    input.fencePhase === "effect_pending" ||
    input.fencePhase === "indeterminate"
  ) {
    return {
      status: "needs_reconciliation",
      reason: "effect_unresolved",
      evidenceSeq: input.startedSeq,
    };
  }
  if (input.fencePhase === "settled") {
    // Without a path/move proof, settlement alone never invents reconcile success.
    if (input.replayClass === "exact_result") {
      return {
        status: "completed",
        reason: "read_completed",
        evidenceSeq: input.startedSeq,
      };
    }
    return {
      status: "not_replayable",
      reason: "effect_not_replayable",
      evidenceSeq: input.startedSeq,
    };
  }

  const terminals = input.related.filter(
    (event) => event.type !== "tool.started",
  );
  const terminal =
    terminals.length === 1 &&
    terminals[0]!.seq > input.startedSeq &&
    field(terminals[0]!, "toolName") === input.startToolName
      ? terminals[0]
      : undefined;
  if (input.effect === "read") {
    return {
      evidenceSeq: terminal?.seq ?? input.startedSeq,
      status:
        terminal?.type === "tool.completed" ? "completed" : "not_replayable",
      reason:
        terminal?.type === "tool.completed" ? "read_completed" : "read_stopped",
    };
  }
  return {
    evidenceSeq: terminal?.seq ?? input.startedSeq,
    status:
      input.effect === "write" && terminal?.type === "tool.completed"
        ? "not_replayable"
        : "needs_reconciliation",
    reason:
      input.effect === "write" && terminal?.type === "tool.completed"
        ? "effect_not_replayable"
        : "effect_unresolved",
  };
}

function replayClassForTool(
  toolName: string,
  effect: "read" | "write" | "unknown",
): ToolReplayClassV1 {
  const sideEffect: ToolSideEffect =
    effect === "read"
      ? "none"
      : effect === "write"
        ? "reversible"
        : "unknown";
  return resolveToolReplayClass({
    toolName,
    sideEffect,
    resultReplay: effect === "read" ? "exact_result_only" : "never",
  });
}

function patchProofs(events: RunEvent[]): Map<number, Proof> {
  const proofs = new Map<number, Proof>();
  for (const move of moveRecoveryEvidence(events)) {
    proofs.set(move.startedSeq, {
      status: move.status,
      reason: move.reason,
      evidenceSeq: move.evidenceSeq,
    });
  }
  for (const patch of settledPatchRecoveryCandidates(events)) {
    proofs.set(patch.startedSeq, {
      status: "completed",
      reason: "patch_settled",
      evidenceSeq: patch.terminal?.completedSeq ?? patch.settledSeq,
    });
  }
  for (const patch of reconciledPatchRecoveryEvidence(events)) {
    proofs.set(patch.startedSeq, {
      status: "completed",
      reason: "patch_reconciled",
      evidenceSeq: patch.completedSeq,
    });
  }
  for (const patch of uncommittedPatchCandidates(events)) {
    proofs.set(patch.startedSeq, {
      status: "not_executed",
      reason: "patch_not_committed",
      evidenceSeq: patch.terminalSeq,
    });
  }
  return proofs;
}

function field(event: RunEvent, key: string): string {
  const value = record(event.payload)?.[key];
  return typeof value === "string" ? value : "";
}

function record(
  value: unknown,
): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
