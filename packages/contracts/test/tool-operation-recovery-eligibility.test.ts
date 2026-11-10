import { describe, expect, it } from "vitest";
import {
  fencePhaseToOrchestrationToolPhase,
  isRunToolRecoveryEligibilityTableV1,
} from "../src/tool-operation-recovery-eligibility.js";

describe("tool operation recovery eligibility contract", () => {
  it("maps fence phases onto orchestration tool phases", () => {
    expect(fencePhaseToOrchestrationToolPhase("intent")).toBe("intent");
    expect(fencePhaseToOrchestrationToolPhase("started")).toBe("intent");
    expect(fencePhaseToOrchestrationToolPhase("effect_pending")).toBe(
      "effect_pending",
    );
    expect(fencePhaseToOrchestrationToolPhase("settled")).toBe("settled");
    expect(fencePhaseToOrchestrationToolPhase("indeterminate")).toBe(
      "indeterminate",
    );
    expect(fencePhaseToOrchestrationToolPhase("none")).toBe("interrupted");
  });

  it("accepts a projected eligibility table", () => {
    expect(
      isRunToolRecoveryEligibilityTableV1({
        kind: "napier.run-tool-recovery-eligibility",
        schemaVersion: 1,
        threadId: "thread_1",
        runId: "run_1",
        revisedAtSeq: 2,
        evidenceLimited: false,
        rows: [],
      }),
    ).toBe(true);
    expect(isRunToolRecoveryEligibilityTableV1({ kind: "other" })).toBe(false);
  });
});
