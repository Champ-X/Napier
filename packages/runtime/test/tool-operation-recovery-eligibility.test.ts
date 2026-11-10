import type { RunEvent, RunRecord } from "@napier/contracts";
import { expect, it } from "vitest";
import {
  fencePhaseFromLedger,
  projectRunToolRecoveryEligibilityTable,
} from "../src/tool-operation-recovery-eligibility.js";
import { projectRunOrchestrationState } from "../src/run-orchestration-projection.js";
import type { ToolOperationLedgerState } from "../src/tool-operation-ledger-support.js";

const run = {
  id: "run_elig",
  threadId: "thread_elig",
  status: "interrupted",
} as RunRecord;

function event(
  seq: number,
  type: string,
  payload: Record<string, unknown>,
): RunEvent {
  return {
    id: `event_${seq}`,
    runId: run.id,
    threadId: run.threadId,
    seq,
    type,
    category: "tool",
    visibility: "debug",
    createdAt: "2026-11-04T00:00:00.000Z",
    payload,
  };
}

it("projects fence phases from the tool.operation journal", () => {
  const state: ToolOperationLedgerState = {
    startedEvents: [],
    proposed: event(1, "tool.operation.proposed", {}),
    admitted: event(2, "tool.operation.admitted", {}),
  };
  expect(fencePhaseFromLedger(state)).toBe("intent");
  state.started = event(3, "tool.operation.started", {});
  state.startedEvents = [state.started];
  expect(fencePhaseFromLedger(state)).toBe("started");
  state.effectBoundary = event(4, "tool.operation.lease.renewed", {});
  expect(fencePhaseFromLedger(state)).toBe("effect_pending");
  state.settled = event(5, "tool.operation.settled", {});
  expect(fencePhaseFromLedger(state)).toBe("settled");
  state.effectIndeterminate = event(6, "tool.operation.effect_indeterminate", {});
  expect(fencePhaseFromLedger(state)).toBe("indeterminate");
});

it("marks journal-backed intent as not_executed and feeds the orchestration register", () => {
  const events = [
    event(1, "tool.started", {
      callId: "call_patch",
      toolName: "apply_patch",
    }),
    event(2, "tool.operation.proposed", {
      kind: "napier.tool-operation",
      schemaVersion: 1,
      parentCallId: "call_patch",
      operationId: "op_patch",
      role: "execution_authority",
      ordinal: 1,
      mode: "write",
      route: "native",
      operation: "apply",
      scope: "workspace",
      contribution: "mutate",
      resourceKeySha256: "a".repeat(64),
      failureDomainKeySha256: "b".repeat(64),
      descriptorSha256: "c".repeat(64),
      phaseStateSha256: "d".repeat(64),
    }),
  ];
  const table = projectRunToolRecoveryEligibilityTable(run, events)!;
  expect(table.rows[0]).toMatchObject({
    parentCallId: "call_patch",
    fencePhase: "intent",
    journalBacked: true,
    recoveryStatus: "not_executed",
    recoveryReason: "patch_not_committed",
    replayClass: "reconcile",
  });
  const orch = projectRunOrchestrationState(run, events)!;
  expect(orch.openToolOps[0]).toMatchObject({
    toolPhase: "intent",
    recoveryStatus: "not_executed",
    replayClass: "reconcile",
  });
});

it("keeps heuristic classification when no operation journal exists", () => {
  const events = [
    event(1, "tool.started", { callId: "call_read", toolName: "read_file" }),
    event(2, "tool.completed", { callId: "call_read", toolName: "read_file" }),
  ];
  const table = projectRunToolRecoveryEligibilityTable(run, events)!;
  expect(table.rows[0]).toMatchObject({
    fencePhase: "none",
    journalBacked: false,
    recoveryStatus: "completed",
    recoveryReason: "read_completed",
    replayClass: "exact_result",
  });
});
