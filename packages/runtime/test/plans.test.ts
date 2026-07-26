import { describe, expect, it } from "vitest";

import {
  createExecutionPlan,
  interruptPlanRun,
  replanExecutionPlan,
  transitionPlanStep,
  updateArtifactManifest,
} from "../src/plans.js";

function createDeliveryPlan() {
  return createExecutionPlan("thread-plan", {
    objective: "Ship a verified runtime change.",
    steps: [
      {
        id: "inspect",
        title: "Inspect",
        description: "Inspect the current runtime behavior.",
        verification: "Record concrete code and test evidence.",
      },
      {
        id: "implement",
        title: "Implement",
        description: "Implement the scoped runtime change.",
        verification: "The implementation builds under strict TypeScript.",
        dependsOn: ["inspect"],
      },
      {
        id: "verify",
        title: "Verify",
        description: "Run focused and full regression checks.",
        verification: "All required checks pass.",
        dependsOn: ["implement"],
      },
    ],
    artifacts: [
      {
        id: "runtime-change",
        path: "packages/runtime/src/plans.ts",
        description: "The plan state machine implementation.",
      },
    ],
  });
}

describe("execution plans", () => {
  it("validates a dependency DAG and promotes newly unblocked steps", () => {
    const created = createDeliveryPlan();
    expect(created.status).toBe("active");
    expect(created.steps.map((step) => step.status)).toEqual([
      "ready",
      "pending",
      "pending",
    ]);
    expect(created.criticalPathStepIds).toEqual([
      "inspect",
      "implement",
      "verify",
    ]);
    expect(created.readyStepIds).toEqual(["inspect"]);
    expect(created.blockedStepIds).toEqual([]);

    const running = transitionPlanStep(created, "inspect", {
      action: "start",
      runId: "run-1",
    });
    expect(running.steps[0]).toEqual(
      expect.objectContaining({ status: "running", runId: "run-1" }),
    );
    expect(() =>
      transitionPlanStep(running, "inspect", { action: "complete" }),
    ).toThrow("require evidence");

    const inspected = transitionPlanStep(running, "inspect", {
      action: "complete",
      evidence: "Reviewed plans.ts and recorded the state invariants.",
    });
    expect(inspected.steps.map((step) => step.status)).toEqual([
      "completed",
      "ready",
      "pending",
    ]);
    expect(inspected.criticalPathStepIds).toEqual(["implement", "verify"]);
    expect(inspected.readyStepIds).toEqual(["implement"]);
    const lateFailure = transitionPlanStep(inspected, "inspect", {
      action: "block",
      blocker: "Late callback",
    });
    expect(lateFailure).toEqual(inspected);
  });

  it("rejects missing dependencies, self-dependencies, and cycles", () => {
    expect(() =>
      createExecutionPlan("thread-plan", {
        objective: "Invalid",
        steps: [
          {
            id: "one",
            title: "One",
            description: "First.",
            verification: "Verified.",
            dependsOn: ["missing"],
          },
        ],
      }),
    ).toThrow("unknown dependency");
    expect(() =>
      createExecutionPlan("thread-plan", {
        objective: "Invalid",
        steps: [
          {
            id: "one",
            title: "One",
            description: "First.",
            verification: "Verified.",
            dependsOn: ["one"],
          },
        ],
      }),
    ).toThrow("depend on itself");
    expect(() =>
      createExecutionPlan("thread-plan", {
        objective: "Invalid",
        steps: [
          {
            id: "one",
            title: "One",
            description: "First.",
            verification: "Verified.",
            dependsOn: ["two"],
          },
          {
            id: "two",
            title: "Two",
            description: "Second.",
            verification: "Verified.",
            dependsOn: ["one"],
          },
        ],
      }),
    ).toThrow("dependency cycle");
  });

  it("blocks interrupted running steps with an unknown outcome", () => {
    const inspected = transitionPlanStep(
      transitionPlanStep(createDeliveryPlan(), "inspect", {
        action: "start",
        runId: "run-1",
      }),
      "inspect",
      {
        action: "complete",
        evidence: "Inspection settled.",
      },
    );
    const running = transitionPlanStep(inspected, "implement", {
      action: "start",
      runId: "run-2",
    });
    const interrupted = interruptPlanRun(running, "run-2");

    expect(interrupted.status).toBe("blocked");
    expect(interrupted.steps[1]).toEqual(
      expect.objectContaining({
        status: "blocked",
        blocker: expect.stringContaining("ended before"),
        evidence: expect.stringContaining("unknown"),
      }),
    );
    expect(interrupted.criticalPathStepIds).toEqual(["implement", "verify"]);
    expect(interrupted.blockedStepIds).toEqual(["implement"]);
    expect(interrupted.replanRecommendation).toEqual(
      expect.objectContaining({
        strategy: "recover_blocked",
        expectedRevision: interrupted.revision,
        supersedeStepIds: ["implement"],
        affectedStepIds: ["implement", "verify"],
        draft: expect.objectContaining({
          policyId: "napier.plan-replan-draft.v1",
          draftSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          evaluation: expect.objectContaining({
            score: 100,
            risk: "low",
            addStepCount: 1,
            dependencyUpdateCount: 1,
            evaluationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
          request: expect.objectContaining({
            addSteps: [
              expect.objectContaining({
                id: "recover-implement",
                dependsOn: ["inspect"],
              }),
            ],
            dependencyUpdates: [
              { stepId: "verify", dependsOn: ["recover-implement"] },
            ],
          }),
        }),
        recommendationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    const drafted = replanExecutionPlan(
      interrupted,
      interrupted.replanRecommendation!.draft.request,
    );
    expect(drafted.readyStepIds).toEqual(["recover-implement"]);
    expect(drafted.criticalPathStepIds).toEqual([
      "recover-implement",
      "verify",
    ]);
    const reopened = transitionPlanStep(interrupted, "implement", {
      action: "reopen",
    });
    expect(reopened.status).toBe("active");
    expect(reopened.steps[1]?.status).toBe("ready");
    expect(reopened.criticalPathStepIds).toEqual(["implement", "verify"]);
    expect(reopened.readyStepIds).toEqual(["implement"]);
    expect(reopened.replanRecommendation).toBeNull();
  });

  it("replans blocked work with revision CAS and hash-bound history", () => {
    const inspected = transitionPlanStep(
      transitionPlanStep(createDeliveryPlan(), "inspect", {
        action: "start",
        runId: "run-1",
      }),
      "inspect",
      {
        action: "complete",
        evidence: "Inspection settled.",
      },
    );
    const blocked = transitionPlanStep(inspected, "implement", {
      action: "block",
      blocker: "The original implementation route is no longer viable.",
      evidence: "The dependency moved during execution.",
    });

    expect(() =>
      replanExecutionPlan(blocked, {
        expectedRevision: blocked.revision - 1,
        strategy: "recover_blocked",
        reason: "Stale revision.",
        evidence: "The caller used an older plan projection.",
        addSteps: [
          {
            id: "implement-fallback",
            title: "Implement fallback",
            description: "Use the replacement implementation path.",
            verification: "Strict TypeScript build passes.",
            dependsOn: ["inspect"],
          },
        ],
      }),
    ).toThrow("revision mismatch");

    const replanned = replanExecutionPlan(blocked, {
      expectedRevision: blocked.revision,
      strategy: "recover_blocked",
      reason: "Original implementation path is blocked.",
      evidence: "The blocker is recorded and a replacement step is required.",
      supersedeStepIds: ["implement"],
      supersedeArtifactIds: ["runtime-change"],
      dependencyUpdates: [
        { stepId: "verify", dependsOn: ["implement-fallback"] },
      ],
      addSteps: [
        {
          id: "implement-fallback",
          title: "Implement fallback",
          description: "Use the replacement implementation path.",
          verification: "Strict TypeScript build passes.",
          dependsOn: ["inspect"],
        },
      ],
      addArtifacts: [
        {
          id: "fallback-change",
          path: "packages/runtime/src/plans.ts",
          description: "The replanned state machine implementation.",
        },
      ],
    });

    expect(replanned.revision).toBe(blocked.revision + 1);
    expect(replanned.status).toBe("active");
    expect(replanned.steps.map((step) => [step.id, step.status])).toEqual([
      ["inspect", "completed"],
      ["implement", "skipped"],
      ["verify", "pending"],
      ["implement-fallback", "ready"],
    ]);
    expect(replanned.steps.find((step) => step.id === "verify")).toEqual(
      expect.objectContaining({ dependsOn: ["implement-fallback"] }),
    );
    expect(
      replanned.artifacts.map((artifact) => [artifact.id, artifact.status]),
    ).toEqual([
      ["runtime-change", "superseded"],
      ["fallback-change", "expected"],
    ]);
    expect(replanned.criticalPathStepIds).toEqual([
      "implement-fallback",
      "verify",
    ]);
    expect(replanned.readyStepIds).toEqual(["implement-fallback"]);
    expect(replanned.replanRecommendation).toBeNull();
    expect(replanned.replans).toEqual([
      expect.objectContaining({
        strategy: "recover_blocked",
        supersededStepIds: ["implement"],
        supersededArtifactIds: ["runtime-change"],
        dependencyUpdatedStepIds: ["verify"],
        addedStepIds: ["implement-fallback"],
        addedArtifactIds: ["fallback-change"],
        fromRevision: blocked.revision,
        toRevision: blocked.revision + 1,
        replanSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        addedStepsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        addedArtifactsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        dependencyUpdatesSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
  });

  it("requires evidence and a digest before settling artifacts", () => {
    const plan = createDeliveryPlan();
    expect(() =>
      updateArtifactManifest(plan, "runtime-change", {
        status: "verified",
        evidence: "Reviewed output.",
      }),
    ).toThrow("Cannot transition artifact");

    const produced = updateArtifactManifest(plan, "runtime-change", {
      status: "produced",
      sourceRunId: "run-3",
      evidence: "plans.ts was written by run-3.",
    });
    expect(produced.artifacts[0]).toEqual(
      expect.objectContaining({
        status: "produced",
        sourceRunId: "run-3",
      }),
    );
    expect(() =>
      updateArtifactManifest(produced, "runtime-change", {
        status: "verified",
        evidence: "Build passed.",
      }),
    ).toThrow("SHA-256");

    const digest = "a".repeat(64);
    const verified = updateArtifactManifest(produced, "runtime-change", {
      status: "verified",
      sha256: digest,
      sizeBytes: 4_096,
      evidence: "Build and focused tests passed.",
    });
    expect(verified.artifacts[0]).toEqual(
      expect.objectContaining({
        status: "verified",
        sha256: digest,
        sizeBytes: 4_096,
      }),
    );
    expect(
      updateArtifactManifest(verified, "runtime-change", {
        status: "missing",
        evidence: "Late stale callback.",
      }),
    ).toEqual(verified);
  });

  it("recommends artifact-drift replanning when required output is missing", () => {
    const completedStep = transitionPlanStep(
      transitionPlanStep(createDeliveryPlan(), "inspect", {
        action: "start",
        runId: "run-1",
      }),
      "inspect",
      {
        action: "complete",
        evidence: "Inspection completed.",
      },
    );
    const implemented = transitionPlanStep(
      transitionPlanStep(completedStep, "implement", {
        action: "start",
        runId: "run-2",
      }),
      "implement",
      {
        action: "complete",
        evidence: "Implementation completed.",
      },
    );
    const verifiedSteps = transitionPlanStep(
      transitionPlanStep(implemented, "verify", {
        action: "start",
        runId: "run-3",
      }),
      "verify",
      {
        action: "complete",
        evidence: "Verification completed.",
      },
    );
    const missingArtifact = updateArtifactManifest(
      verifiedSteps,
      "runtime-change",
      {
        status: "missing",
        sourceRunId: "run-3",
        evidence: "The planned output was not found during final audit.",
      },
    );

    expect(missingArtifact.status).toBe("blocked");
    expect(missingArtifact.readyStepIds).toEqual([]);
    expect(missingArtifact.replanRecommendation).toEqual(
      expect.objectContaining({
        strategy: "artifact_drift",
        expectedRevision: missingArtifact.revision,
        supersedeArtifactIds: ["runtime-change"],
        affectedArtifactIds: ["runtime-change"],
        draft: expect.objectContaining({
          policyId: "napier.plan-replan-draft.v1",
          draftSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          evaluation: expect.objectContaining({
            score: 100,
            risk: "low",
            addStepCount: 1,
            addArtifactCount: 1,
            evaluationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
          request: expect.objectContaining({
            addSteps: [
              expect.objectContaining({
                id: "restore-runtime-change",
              }),
            ],
            addArtifacts: [
              expect.objectContaining({
                id: "replacement-runtime-change",
                path: "packages/runtime/src/plans.ts",
              }),
            ],
          }),
        }),
        recommendationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    const drafted = replanExecutionPlan(
      missingArtifact,
      missingArtifact.replanRecommendation!.draft.request,
    );
    expect(drafted.readyStepIds).toEqual(["restore-runtime-change"]);
    expect(
      drafted.artifacts.map((artifact) => [artifact.id, artifact.status]),
    ).toEqual([
      ["runtime-change", "superseded"],
      ["replacement-runtime-change", "expected"],
    ]);
  });

  it("rejects artifact paths that escape the workspace", () => {
    expect(() =>
      createExecutionPlan("thread-plan", {
        objective: "Invalid artifact",
        steps: [
          {
            id: "inspect",
            title: "Inspect",
            description: "Inspect.",
            verification: "Verified.",
          },
        ],
        artifacts: [
          {
            id: "escape",
            path: "../secret.txt",
            description: "Invalid.",
          },
        ],
      }),
    ).toThrow("escapes the workspace");
  });
});
