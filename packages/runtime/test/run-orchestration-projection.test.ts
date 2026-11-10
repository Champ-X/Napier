import type { RunEvent, RunRecord } from "@napier/contracts";
import { expect, it } from "vitest";
import { projectRunOrchestrationState } from "../src/run-orchestration-projection.js";
import { projectRunRecoveryCheckpoint } from "../src/run-recovery-checkpoint.js";
import { orchestrationBlocksAutomaticReplay } from "@napier/contracts/run-orchestration-state";

const run = {
  id: "run_source",
  threadId: "thread_source",
  status: "interrupted",
} as RunRecord;

const event = (
  seq: number,
  type: string,
  toolName = "read_file",
  callId = "call_source",
): RunEvent => ({
  id: `event_${seq}`,
  runId: run.id,
  threadId: run.threadId,
  seq,
  type,
  category: "tool",
  visibility: "debug",
  createdAt: "2026-10-29T00:00:00.000Z",
  payload: { callId, toolName },
});

it("projects a total orchestration register that matches recovery checkpoint rows", () => {
  const events = [
    event(1, "tool.started", "read_file"),
    event(2, "tool.completed", "read_file"),
    event(3, "tool.started", "bash", "call_bash"),
    event(4, "tool.completed", "bash", "call_bash"),
  ];
  const state = projectRunOrchestrationState(run, events)!;
  const checkpoint = projectRunRecoveryCheckpoint(run, events)!;
  expect(state).toMatchObject({
    kind: "napier.run-orchestration-state",
    schemaVersion: 1,
    phase: "terminal",
    source: "projected",
    toolStartTotal: 2,
    cancelRequested: false,
  });
  expect(state.openToolOps.map((op) => op.replayClass)).toEqual([
    "never",
    "exact_result",
  ]);
  expect(checkpoint.operations.map((op) => op.status)).toEqual(
    state.openToolOps.map((op) => op.recoveryStatus),
  );
  expect(orchestrationBlocksAutomaticReplay(state)).toBe(false);
});

it("blocks automatic replay when an operation remains uncertain", () => {
  const state = projectRunOrchestrationState(run, [
    event(1, "tool.started", "bash"),
  ])!;
  expect(state.openToolOps[0]).toMatchObject({
    toolPhase: "indeterminate",
    recoveryStatus: "needs_reconciliation",
    replayClass: "never",
  });
  expect(orchestrationBlocksAutomaticReplay(state)).toBe(true);
});
