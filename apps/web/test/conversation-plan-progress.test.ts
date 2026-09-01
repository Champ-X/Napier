import type { PlanStep, PlanStepStatus, ThreadDetail } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { conversationPlanProgress } from "../src/conversation-plan-progress";

describe("conversation plan progress", () => {
  it("projects the ordered current step and settled progress from the active plan", () => {
    const progress = conversationPlanProgress(detail(), true);

    expect(progress).toEqual(
      expect.objectContaining({
        planId: "plan_progress0001",
        objective: "Deliver the verified page",
        currentStepNumber: 2,
        stepCount: 3,
        settledStepCount: 1,
      }),
    );
    expect(progress?.steps.map((step) => [step.title, step.current])).toEqual([
      ["Inspect", false],
      ["Implement", true],
      ["Verify", false],
    ]);
  });

  it("stays out of the composer when the Run is idle or no plan is active", () => {
    expect(conversationPlanProgress(detail(), false)).toBeUndefined();
    const { activePlan: _activePlan, ...withoutActivePlan } = detail();
    expect(conversationPlanProgress(withoutActivePlan, true)).toBeUndefined();
  });

  it("prefers the live conversation projection over a stale plan snapshot", () => {
    const input = detail();
    const canonical = input.plans[0]!;
    input.conversationPlans = [
      {
        id: "event_progress0001",
        seq: 9,
        createdAt: "2026-09-01T00:00:02.000Z",
        attemptScope: "current",
        plan: {
          id: canonical.id,
          status: canonical.status,
          revision: canonical.revision,
          objective: canonical.objective,
          steps: canonical.steps.map((step) => ({
            id: step.id,
            title:
              step.id === "step_implement"
                ? "Live implementation status"
                : step.title,
            status: step.status,
            evidenceRecorded: Boolean(step.evidence),
          })),
          activePhaseIndex: canonical.activePhaseIndex,
          phaseCount: canonical.phaseWaves.length,
        },
        completedStepCount: 1,
        settledStepCount: 1,
        runningStep: {
          id: "step_implement",
          title: "Live implementation status",
          status: "running",
          evidenceRecorded: false,
        },
        verifiedArtifactCount: 0,
        producedArtifactCount: 0,
        missingArtifactCount: 0,
      },
    ];

    expect(conversationPlanProgress(input, true)?.steps[1]?.title).toBe(
      "Live implementation status",
    );
  });
});

function detail(): Pick<
  ThreadDetail,
  "activePlan" | "plans" | "conversationPlans"
> {
  const steps = [
    planStep("step_inspect", "Inspect", "completed"),
    planStep("step_implement", "Implement", "running"),
    planStep("step_verify", "Verify", "ready"),
  ];
  return {
    activePlan: {
      planId: "plan_progress0001",
      revision: 1,
      status: "active",
      objective: "Deliver the verified page",
      completedStepCount: 1,
      settledStepCount: 1,
      stepCount: 3,
      runningStep: steps[1]!,
      nextStep: steps[2]!,
      verifiedArtifactCount: 0,
      producedArtifactCount: 0,
      missingArtifactCount: 0,
      outputPaths: [],
      activePhaseIndex: 0,
      phaseCount: 1,
      eventWatermark: 4,
    },
    plans: [
      {
        id: "plan_progress0001",
        threadId: "thread_progress0001",
        objective: "Deliver the verified page",
        status: "active",
        steps,
        artifacts: [],
        replans: [],
        replanRecommendation: null,
        criticalPathStepIds: steps.map((step) => step.id),
        readyStepIds: ["step_verify"],
        blockedStepIds: [],
        phaseWaves: [],
        activePhaseIndex: 0,
        parallelReadyStepIds: [],
        phaseProjectionSha256: "a".repeat(64),
        revision: 1,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:01.000Z",
      },
    ],
    conversationPlans: [],
  };
}

function planStep(id: string, title: string, status: PlanStepStatus): PlanStep {
  return {
    id,
    title,
    description: `${title} description`,
    status,
    dependsOn: [],
    verification: `${title} verified`,
    evidence: status === "completed" ? `${title} evidence` : "",
    ...(status === "running" ? { runId: "run_progress0001" } : {}),
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:01.000Z",
  };
}
