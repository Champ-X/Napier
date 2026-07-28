import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  planEventTraceSummary,
  planEventTraceView,
} from "../src/plan-event-view";

describe("Plan event trace view", () => {
  it("projects plan creation without objective text", () => {
    const event = planEvent("plan.created", {
      planId: "plan_1234567890",
      objective: "TOP_SECRET_PLAN_OBJECTIVE",
      status: "active",
      stepCount: 3,
      artifactCount: 2,
      criticalPathStepIds: ["step_a", "step_b"],
      readyStepIds: ["step_c"],
      blockedStepIds: [],
      activePhaseIndex: 1,
      parallelReadyStepIds: ["step_c", "step_d"],
      phaseWaveCount: 2,
      phaseProjectionSha256: "a".repeat(64),
      blueprintRecordId: "blueprint_record_1234567890",
      blueprintSha256: "b".repeat(64),
      blueprintSourcePlanId: "plan_source_0987654321",
      blueprintSourcePlanRevision: 7,
      blueprintSourceArchiveSha256: "c".repeat(64),
      blueprintQualificationStatus: "qualified",
      blueprintQualificationSha256: "d".repeat(64),
      blueprintQualificationDiagnosticsSha256: "e".repeat(64),
      blueprintPreviewSha256: "f".repeat(64),
    });

    expect(planEventTraceView(event)).toEqual({
      action: "created",
      planId: "plan_1234567890",
      blueprintRecordId: "blueprint_record_1234567890",
      blueprintSourcePlanId: "plan_source_0987654321",
      status: "active",
      blueprintQualificationStatus: "qualified",
      stepCount: 3,
      artifactCount: 2,
      criticalPathStepCount: 2,
      readyStepCount: 1,
      blockedStepCount: 0,
      parallelReadyStepCount: 2,
      activePhaseIndex: 1,
      phaseWaveCount: 2,
      blueprintSourcePlanRevision: 7,
      phaseProjectionSha256: "a".repeat(64),
      blueprintSha256: "b".repeat(64),
      blueprintSourceArchiveSha256: "c".repeat(64),
      blueprintQualificationSha256: "d".repeat(64),
      blueprintQualificationDiagnosticsSha256: "e".repeat(64),
      blueprintPreviewSha256: "f".repeat(64),
    });
    expect(planEventTraceSummary(event)).toBe(
      `plan / created / plan 1234567890 / blueprint-record 1234567890 / blueprint-source-plan 0987654321 / status active / blueprint-qualification qualified / steps 3 / artifacts 2 / critical 2 / ready 1 / blocked 0 / parallel-ready 2 / active-phase 1 / phase-waves 2 / blueprint-source-r7 / phase ${"a".repeat(12)} / blueprint ${"b".repeat(12)} / blueprint-source-archive ${"c".repeat(12)} / blueprint-qualification ${"d".repeat(12)} / blueprint-diagnostics ${"e".repeat(12)} / blueprint-preview ${"f".repeat(12)}`,
    );
    expect(planEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects step and artifact transitions without prose or paths", () => {
    const step = planEvent("plan.step.completed", {
      planId: "plan_1234567890",
      stepId: "step_abcdef1234",
      runId: "run_step_1234567890",
      title: "TOP_SECRET_STEP_TITLE",
      status: "completed",
      planStatus: "active",
      evidence: "TOP_SECRET_STEP_EVIDENCE",
      blocker: "TOP_SECRET_BLOCKER",
      readyStepIds: ["step_next"],
      blockedStepIds: [],
      phaseProjectionSha256: "0".repeat(64),
    });
    const artifact = planEvent("plan.artifact.verified", {
      planId: "plan_1234567890",
      artifactId: "artifact_0987654321",
      sourceRunId: "run_artifact_1234567890",
      path: "TOP_SECRET_ARTIFACT_PATH",
      status: "verified",
      evidence: "TOP_SECRET_ARTIFACT_EVIDENCE",
      sha256: "1".repeat(64),
      pathSha256: "2".repeat(64),
      evidenceSha256: "3".repeat(64),
      sizeBytes: 4096,
      criticalPathStepIds: ["step_a"],
      readyStepIds: [],
      blockedStepIds: [],
    });

    expect(planEventTraceSummary(step)).toBe(
      `plan / step.completed / plan 1234567890 / step abcdef1234 / run 1234567890 / status completed / plan-status active / ready 1 / blocked 0 / phase ${"0".repeat(12)}`,
    );
    expect(planEventTraceSummary(artifact)).toBe(
      `plan / artifact.verified / plan 1234567890 / artifact 0987654321 / source-run 1234567890 / status verified / critical 1 / ready 0 / blocked 0 / size-bytes 4096 / artifact ${"1".repeat(12)} / artifact-path ${"2".repeat(12)} / artifact-evidence ${"3".repeat(12)}`,
    );
    expect(planEventTraceSummary(step)).not.toContain("TOP_SECRET");
    expect(planEventTraceSummary(artifact)).not.toContain("TOP_SECRET");
  });

  it("projects replans and audits as bounded metadata", () => {
    const replan = planEvent("plan.replanned", {
      planId: "plan_1234567890",
      replanId: "replan_1234567890",
      reason: "TOP_SECRET_REPLAN_REASON",
      evidence: "TOP_SECRET_REPLAN_EVIDENCE",
      strategy: "repair_missing_artifact",
      fromRevision: 2,
      toRevision: 3,
      status: "active",
      addedStepIds: ["step_new"],
      addedArtifactIds: [],
      supersededStepIds: ["step_old"],
      supersededArtifactIds: ["artifact_old"],
      dependencyUpdatedStepIds: ["step_dep"],
      replanSha256: "2".repeat(64),
      addedStepsSha256: "3".repeat(64),
      addedArtifactsSha256: "4".repeat(64),
      dependencyUpdatesSha256: "5".repeat(64),
      phaseWaveCount: 4,
      phaseProjectionSha256: "6".repeat(64),
    });
    const audit = planEvent("plan.audit", {
      planId: "plan_1234567890",
      blueprintSha256: "7".repeat(64),
    });

    expect(planEventTraceSummary(replan)).toBe(
      `plan / replanned / plan 1234567890 / replan 1234567890 / status active / strategy repair_missing_artifact / added-steps 1 / added-artifacts 0 / superseded-steps 1 / superseded-artifacts 1 / dependency-updates 1 / phase-waves 4 / from r2 / to r3 / phase ${"6".repeat(12)} / replan ${"2".repeat(12)} / added-steps ${"3".repeat(12)} / added-artifacts ${"4".repeat(12)} / dependency-updates ${"5".repeat(12)}`,
    );
    expect(planEventTraceSummary(audit)).toBe(
      `plan / audit / plan 1234567890 / blueprint ${"7".repeat(12)}`,
    );
    expect(planEventTraceSummary(replan)).not.toContain("TOP_SECRET");
  });

  it("fails closed for malformed and unknown plan receipts", () => {
    expect(
      planEventTraceSummary(planEvent("plan.created", ["TOP_SECRET_OBJECTIVE"])),
    ).toBe("plan receipt");
    expect(
      planEventTraceSummary(
        planEvent("plan.future", { objective: "TOP_SECRET_OBJECTIVE" }),
      ),
    ).toBe("plan");
  });
});

function planEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_plan",
    runId: "run_plan",
    seq: 41,
    type,
    category: "plan",
    visibility: "debug",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
