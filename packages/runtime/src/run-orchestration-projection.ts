import type { RunEvent, RunRecord } from "@napier/contracts";
import {
  emptyToolOpCounts,
  type RunOrchestrationPhaseV1,
  type RunOrchestrationStateV1,
  type RunOrchestrationToolOpV1,
  type RunOrchestrationToolPhaseV1,
} from "@napier/contracts/run-orchestration-state";
import type {
  RecoveryOperationReason,
  RecoveryOperationStatus,
} from "@napier/contracts/manual-run-recovery";
import { fencePhaseToOrchestrationToolPhase } from "@napier/contracts/tool-operation-recovery-eligibility";
import { isSubagentChildRun } from "./primary-run-selection.js";
import { projectRunToolRecoveryEligibilityTable } from "./tool-operation-recovery-eligibility.js";
import { hasDurableRunCancelRequest } from "./run-cancel-request.js";

const LIMIT = 10_000;
const ROW_LIMIT = 128;

/**
 * Project the Run orchestration program counter from ledger evidence.
 * Recovery should read this total state rather than re-inferring phase ad hoc.
 * Tool op rows come only from the recovery eligibility table — no second classifier.
 */
export function projectRunOrchestrationState(
  run: RunRecord | undefined,
  source: RunEvent[],
  runs: RunRecord[] = [],
): RunOrchestrationStateV1 | undefined {
  if (
    !run ||
    isSubagentChildRun(run) ||
    (run.status !== "interrupted" &&
      run.status !== "failed" &&
      run.status !== "cancelled" &&
      run.status !== "completed" &&
      run.status !== "running" &&
      run.status !== "queued")
  ) {
    return undefined;
  }
  const origin = inspectionOrigin(run, runs);
  const events = source
    .filter(
      (event) => event.runId === origin?.id && event.threadId === run.threadId,
    )
    .sort((a, b) => a.seq - b.seq);
  const starts = events.filter((event) => event.type === "tool.started");
  const evidenceLimited =
    !origin ||
    events.length > LIMIT ||
    new Set(events.map((event) => event.seq)).size !== events.length ||
    new Set(events.map((event) => event.id)).size !== events.length;
  const base: RunOrchestrationStateV1 = {
    kind: "napier.run-orchestration-state",
    schemaVersion: 1,
    threadId: run.threadId,
    runId: run.id,
    sourceRunId: origin?.id ?? run.id,
    phase: resolvePhase(run, events),
    cancelRequested:
      run.status === "cancelled" ||
      (origin ? hasDurableRunCancelRequest(events, origin.id) : false) ||
      events.some((event) => event.type === "run.control.cancelled"),
    ...(run.configuration?.contentSha256
      ? { configSnapshotHash: run.configuration.contentSha256 }
      : {}),
    revisedAtSeq: events.at(-1)?.seq ?? 0,
    evidenceLimited,
    toolStartTotal: starts.length,
    openToolOps: [],
    toolOpCounts: emptyToolOpCounts(),
    source: "projected",
  };
  if (evidenceLimited) return base;

  const eligibility =
    origin && projectRunToolRecoveryEligibilityTable(origin, events);
  const operations = (eligibility?.rows ?? []).map(
    (eligible): RunOrchestrationToolOpV1 => ({
      callId: eligible.parentCallId,
      toolName: eligible.toolName,
      startedSeq: eligible.startedSeq,
      evidenceSeq: eligible.evidenceSeq,
      toolPhase: eligible.journalBacked
        ? fencePhaseToOrchestrationToolPhase(eligible.fencePhase)
        : toolPhaseFor(eligible.recoveryStatus, eligible.recoveryReason),
      replayClass: eligible.replayClass,
      recoveryStatus: eligible.recoveryStatus,
      recoveryReason: eligible.recoveryReason,
    }),
  );

  for (const operation of operations) {
    base.toolOpCounts[operation.recoveryStatus] += 1;
  }
  const priority: Record<RecoveryOperationStatus, number> = {
    needs_reconciliation: 0,
    not_executed: 1,
    not_replayable: 2,
    completed: 3,
  };
  base.openToolOps = operations
    .sort(
      (a, b) =>
        priority[a.recoveryStatus] - priority[b.recoveryStatus] ||
        a.startedSeq - b.startedSeq,
    )
    .slice(0, ROW_LIMIT);
  return base;
}

function toolPhaseFor(
  status: RecoveryOperationStatus,
  reason: RecoveryOperationReason,
): RunOrchestrationToolPhaseV1 {
  if (status === "completed") return "settled";
  if (status === "not_executed") return "intent";
  if (
    reason === "effect_unresolved" ||
    reason === "evidence_missing" ||
    status === "needs_reconciliation"
  ) {
    return "indeterminate";
  }
  return "interrupted";
}

function resolvePhase(
  run: RunRecord,
  events: RunEvent[],
): RunOrchestrationPhaseV1 {
  if (
    run.status === "interrupted" ||
    run.status === "failed" ||
    run.status === "cancelled" ||
    run.status === "completed"
  ) {
    return "terminal";
  }
  if (run.status === "queued") return "ready";
  const last = [...events].reverse().find((event) =>
    [
      "tool.started",
      "tool.completed",
      "tool.failed",
      "model.response.completed",
      "model.request.started",
      "tool.operation.settled",
      "tool.operation.started",
      "tool.operation.effect_indeterminate",
      "operator.decision.requested",
      "workflow.approval.requested",
      "workflow.breakpoint.reached",
    ].includes(event.type),
  );
  if (!last) return run.status === "running" ? "generating" : "ready";
  if (
    last.type === "operator.decision.requested" ||
    last.type === "workflow.approval.requested" ||
    last.type === "workflow.breakpoint.reached"
  ) {
    return "waiting_decision";
  }
  if (
    last.type === "tool.started" ||
    last.type === "tool.operation.started" ||
    last.type === "tool.operation.effect_indeterminate"
  ) {
    return "tooling";
  }
  if (last.type.startsWith("model.")) return "generating";
  if (last.type === "tool.operation.settled") return "settling";
  return "tooling";
}

/** Inspection must not erase unresolved effects from the checkpoint it examined. */
function inspectionOrigin(
  run: RunRecord,
  runs: RunRecord[],
): RunRecord | undefined {
  const seen = new Set<string>();
  while (
    run.source === "recovery" &&
    run.configuration &&
    "executionMode" in run.configuration &&
    run.configuration.executionMode === "safe_read_only_recovery"
  ) {
    if (seen.has(run.id) || seen.size >= 16) return undefined;
    seen.add(run.id);
    const parent = runs.find(
      (candidate) =>
        candidate.id === run.parentRunId && candidate.threadId === run.threadId,
    );
    if (!parent) return undefined;
    run = parent;
  }
  return isSubagentChildRun(run) ? undefined : run;
}
