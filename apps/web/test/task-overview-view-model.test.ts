import { describe, expect, it } from "vitest";

import { deriveTaskOverview } from "../src/task-overview-view-model";

function step(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    title: "Step",
    description: "",
    verification: "",
    dependsOn: [],
    status: "pending",
    evidence: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as never;
}

function plan(steps: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    threadId: "t1",
    objective: "Ship the release",
    status: "active",
    steps,
    artifacts: [],
    replans: [],
    replanRecommendation: null,
    criticalPathStepIds: [],
    readyStepIds: [],
    blockedStepIds: [],
    phaseWaves: [],
    activePhaseIndex: null,
    parallelReadyStepIds: [],
    phaseProjectionSha256: "",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as never;
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    thread: { title: "Thread title" },
    plans: [],
    ...overrides,
  } as never;
}

describe("deriveTaskOverview", () => {
  it("returns an empty model when no detail is present", () => {
    const model = deriveTaskOverview(undefined, undefined);
    expect(model.hasPlan).toBe(false);
    expect(model.hasObjective).toBe(false);
    expect(model.currentStep).toBeUndefined();
    expect(model.completedSteps).toEqual([]);
    expect(model.upcomingSteps).toEqual([]);
    expect(model.canContinue).toBe(false);
  });

  it("prefers the projected objective and progress counters", () => {
    const model = deriveTaskOverview(
      detail({
        plans: [plan([step({ id: "s1", status: "completed" })])],
        activePlan: {
          objective: "Projected objective",
          status: "active",
          completedStepCount: 3,
          stepCount: 5,
          verifiedArtifactCount: 2,
          producedArtifactCount: 1,
          nextStep: { id: "s2", title: "Run tests", status: "ready" },
        },
      }),
      undefined,
    );
    expect(model.objective).toBe("Projected objective");
    expect(model.completedStepCount).toBe(3);
    expect(model.stepCount).toBe(5);
    expect(model.artifactCount).toBe(3);
    expect(model.canContinue).toBe(true);
  });

  it("splits steps into a single current step plus folded history", () => {
    const model = deriveTaskOverview(
      detail({
        plans: [
          plan([
            step({ id: "a", status: "completed", title: "Read files" }),
            step({ id: "b", status: "running", title: "Edit module" }),
            step({ id: "c", status: "ready", title: "Run tests" }),
            step({ id: "d", status: "pending", title: "Report" }),
          ]),
        ],
      }),
      undefined,
    );
    expect(model.currentStep?.id).toBe("b");
    expect(model.completedSteps.map((s) => s.id)).toEqual(["a"]);
    expect(model.upcomingSteps.map((s) => s.id)).toEqual(["c", "d"]);
  });

  it("surfaces the blocker on a blocked current step", () => {
    const model = deriveTaskOverview(
      detail({
        plans: [
          plan(
            [
              step({
                id: "x",
                status: "blocked",
                title: "Deploy",
                blocker: "Waiting for approval",
              }),
            ],
            { status: "blocked" },
          ),
        ],
      }),
      undefined,
    );
    expect(model.currentStep?.id).toBe("x");
    expect(model.currentStep?.blocker).toBe("Waiting for approval");
    expect(model.status).toBe("blocked");
  });

  it("falls back to the goal objective when no plan objective exists", () => {
    const model = deriveTaskOverview(
      detail({ thread: { title: "" }, plans: [] }),
      { objective: "Durable goal" } as never,
    );
    expect(model.objective).toBe("Durable goal");
    expect(model.hasObjective).toBe(true);
    expect(model.hasPlan).toBe(false);
  });
});
