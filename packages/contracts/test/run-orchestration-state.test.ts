import { describe, expect, it } from "vitest";
import {
  emptyToolOpCounts,
  isRunOrchestrationStateV1,
  orchestrationBlocksAutomaticReplay,
  type RunOrchestrationStateV1,
} from "../src/run-orchestration-state.js";

describe("RunOrchestrationStateV1", () => {
  it("accepts a total projected register", () => {
    expect(isRunOrchestrationStateV1(state())).toBe(true);
    expect(isRunOrchestrationStateV1({ kind: "other" })).toBe(false);
  });

  it("blocks automatic replay when evidence is limited or an op is uncertain", () => {
    expect(orchestrationBlocksAutomaticReplay(state())).toBe(false);
    expect(
      orchestrationBlocksAutomaticReplay(state({ evidenceLimited: true })),
    ).toBe(true);
    expect(
      orchestrationBlocksAutomaticReplay(
        state({
          openToolOps: [
            {
              callId: "call_1",
              toolName: "bash",
              startedSeq: 1,
              evidenceSeq: 1,
              toolPhase: "effect_pending",
              replayClass: "never",
              recoveryStatus: "needs_reconciliation",
              recoveryReason: "effect_unresolved",
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("starts tool op counts at zero", () => {
    expect(emptyToolOpCounts()).toEqual({
      completed: 0,
      not_executed: 0,
      needs_reconciliation: 0,
      not_replayable: 0,
    });
  });
});

function state(
  overrides: Partial<RunOrchestrationStateV1> = {},
): RunOrchestrationStateV1 {
  return {
    kind: "napier.run-orchestration-state",
    schemaVersion: 1,
    threadId: "thread_orch",
    runId: "run_orch",
    sourceRunId: "run_orch",
    phase: "terminal",
    cancelRequested: false,
    revisedAtSeq: 3,
    evidenceLimited: false,
    toolStartTotal: 0,
    openToolOps: [],
    toolOpCounts: emptyToolOpCounts(),
    source: "projected",
    ...overrides,
  };
}
