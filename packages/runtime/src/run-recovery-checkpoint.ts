import type { RunEvent, RunRecord } from "@napier/contracts";
import type { RunRecoveryCheckpoint } from "@napier/contracts/manual-run-recovery";
import {
  collectRunToolEffectObservations,
  normalizeToolName,
} from "./run-tool-effect-observations.js";
import { settledPatchRecoveryCandidates } from "./run-patch-recovery-evidence.js";
import { reconciledPatchRecoveryEvidence } from "./workspace-patch-reconciled-evidence.js";
import { uncommittedPatchCandidates } from "./workspace-patch-uncommitted-evidence.js";

type Operation = RunRecoveryCheckpoint["operations"][number];
const LIMIT = 10_000;
const ROW_LIMIT = 128;

/** Same projection for HTTP/SDK and local consumers. No private inputs or paths. */
export function projectRunRecoveryCheckpoint(
  run: RunRecord | undefined,
  source: RunEvent[],
  runs: RunRecord[] = [],
): RunRecoveryCheckpoint | undefined {
  if (!run || (run.status !== "interrupted" && run.status !== "failed"))
    return undefined;
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
  const view: RunRecoveryCheckpoint = {
    runId: run.id,
    sourceRunId: origin?.id ?? run.id,
    throughSeq: events.at(-1)?.seq ?? 0,
    evidenceLimited,
    total: starts.length,
    omitted: starts.length,
    counts: {
      completed: 0,
      not_executed: 0,
      needs_reconciliation: 0,
      not_replayable: 0,
    },
    operations: [],
  };
  if (evidenceLimited) return view;
  const proofs = patchProofs(events);
  const observations = collectRunToolEffectObservations(events);
  const calls = new Map<string, RunEvent[]>();
  for (const event of events) {
    if (!["tool.started", "tool.completed", "tool.failed"].includes(event.type))
      continue;
    const callId = field(event, "callId");
    const bucket = calls.get(callId) ?? [];
    bucket.push(event);
    calls.set(callId, bucket);
  }
  const operations = starts.map((start, index): Operation => {
    const callId = field(start, "callId");
    const related = calls.get(callId) ?? [];
    const base = {
      callId: callId.slice(0, 200),
      toolName: normalizeToolName(field(start, "toolName")),
      startedSeq: start.seq,
      evidenceSeq: start.seq,
    };
    if (
      !callId ||
      related.filter((e) => e.type === "tool.started").length !== 1
    )
      return {
        ...base,
        status: "needs_reconciliation",
        reason: "evidence_missing",
      };
    const proof = proofs.get(start.seq);
    if (proof) return { ...base, ...proof };
    const terminals = related.filter((event) => event.type !== "tool.started");
    const terminal =
      terminals.length === 1 &&
      terminals[0]!.seq > start.seq &&
      field(terminals[0]!, "toolName") === field(start, "toolName")
        ? terminals[0]
        : undefined;
    const effect = observations[index]?.effect ?? "unknown";
    if (effect === "read")
      return {
        ...base,
        evidenceSeq: terminal?.seq ?? start.seq,
        status:
          terminal?.type === "tool.completed" ? "completed" : "not_replayable",
        reason:
          terminal?.type === "tool.completed"
            ? "read_completed"
            : "read_stopped",
      };
    return {
      ...base,
      evidenceSeq: terminal?.seq ?? start.seq,
      status:
        effect === "write" && terminal?.type === "tool.completed"
          ? "not_replayable"
          : "needs_reconciliation",
      reason:
        effect === "write" && terminal?.type === "tool.completed"
          ? "effect_not_replayable"
          : "effect_unresolved",
    };
  });
  for (const operation of operations) view.counts[operation.status] += 1;
  // Keep uncertain/pending work visible when history exceeds the display bound.
  const priority = {
    needs_reconciliation: 0,
    not_executed: 1,
    not_replayable: 2,
    completed: 3,
  };
  view.operations = operations
    .sort(
      (a, b) =>
        priority[a.status] - priority[b.status] || a.startedSeq - b.startedSeq,
    )
    .slice(0, ROW_LIMIT);
  view.omitted = view.total - view.operations.length;
  return view;
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
  return run;
}

function patchProofs(
  events: RunEvent[],
): Map<number, Pick<Operation, "status" | "reason" | "evidenceSeq">> {
  const proofs = new Map<
    number,
    Pick<Operation, "status" | "reason" | "evidenceSeq">
  >();
  for (const patch of settledPatchRecoveryCandidates(events))
    proofs.set(patch.startedSeq, {
      status: "completed",
      reason: "patch_settled",
      evidenceSeq: patch.terminal?.completedSeq ?? patch.settledSeq,
    });
  for (const patch of reconciledPatchRecoveryEvidence(events))
    proofs.set(patch.startedSeq, {
      status: "completed",
      reason: "patch_reconciled",
      evidenceSeq: patch.completedSeq,
    });
  for (const patch of uncommittedPatchCandidates(events))
    proofs.set(patch.startedSeq, {
      status: "not_executed",
      reason: "patch_not_committed",
      evidenceSeq: patch.terminalSeq,
    });
  return proofs;
}

function field(event: RunEvent, key: string): string {
  const value =
    event.payload &&
    typeof event.payload === "object" &&
    !Array.isArray(event.payload)
      ? event.payload[key]
      : undefined;
  return typeof value === "string" ? value : "";
}
