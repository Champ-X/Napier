import { createHash } from "node:crypto";

import type { JsonValue, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  assertPlanArtifactEventBindings,
  createPlanArtifactEventPayload,
  createExecutionPlan,
  interruptPlanRun,
  recoverCompletedPlanStep,
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
    expect(created.activePhaseIndex).toBe(0);
    expect(created.parallelReadyStepIds).toEqual(["inspect"]);
    expect(created.phaseWaves.map((wave) => wave.stepIds)).toEqual([
      ["inspect"],
      ["implement"],
      ["verify"],
    ]);
    expect(created.phaseProjectionSha256).toMatch(/^[a-f0-9]{64}$/);

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
    expect(inspected.activePhaseIndex).toBe(1);
    expect(inspected.parallelReadyStepIds).toEqual(["implement"]);
    expect(inspected.phaseProjectionSha256).not.toBe(
      created.phaseProjectionSha256,
    );
    const lateFailure = transitionPlanStep(inspected, "inspect", {
      action: "block",
      blocker: "Late callback",
    });
    expect(lateFailure).toEqual(inspected);
  });

  it("recovers completion only for the same blocked Plan Run", () => {
    const running = transitionPlanStep(createDeliveryPlan(), "inspect", {
      action: "start",
      runId: "run-original",
    });
    const blocked = transitionPlanStep(running, "inspect", {
      action: "block",
      blocker: "Run settlement was interrupted.",
      evidence: "A terminal tool receipt may still prove completion.",
    });

    expect(() =>
      recoverCompletedPlanStep(
        blocked,
        "inspect",
        "run-other",
        "Mismatched evidence.",
      ),
    ).toThrow("same blocked Plan Run");
    expect(() =>
      recoverCompletedPlanStep(
        running,
        "inspect",
        "run-original",
        "Premature evidence.",
      ),
    ).toThrow("same blocked Plan Run");

    const recovered = recoverCompletedPlanStep(
      blocked,
      "inspect",
      "run-original",
      "The bound terminal tool event passed its output schema.",
    );
    expect(recovered.steps[0]).toEqual(
      expect.objectContaining({
        status: "completed",
        runId: "run-original",
        evidence: "The bound terminal tool event passed its output schema.",
      }),
    );
    expect(recovered.steps[1]?.status).toBe("ready");
    expect(recovered.revision).toBe(blocked.revision + 1);
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
    expect(drafted.phaseWaves.map((wave) => wave.stepIds)).toEqual([
      ["inspect"],
      ["implement", "recover-implement"],
      ["verify"],
    ]);
    expect(drafted.activePhaseIndex).toBe(1);
    expect(drafted.parallelReadyStepIds).toEqual(["recover-implement"]);
    const reopened = transitionPlanStep(interrupted, "implement", {
      action: "reopen",
    });
    expect(reopened.status).toBe("active");
    expect(reopened.steps[1]?.status).toBe("ready");
    expect(reopened.criticalPathStepIds).toEqual(["implement", "verify"]);
    expect(reopened.readyStepIds).toEqual(["implement"]);
    expect(reopened.activePhaseIndex).toBe(1);
    expect(reopened.parallelReadyStepIds).toEqual(["implement"]);
    expect(reopened.replanRecommendation).toBeNull();
  });

  it("derives Deer Workflow-style phase waves and parallel ready sets", () => {
    const plan = createExecutionPlan("thread-plan", {
      objective: "Coordinate parallel implementation work.",
      steps: [
        {
          id: "inspect",
          title: "Inspect",
          description: "Inspect the target surface.",
          verification: "Inspection evidence is recorded.",
        },
        {
          id: "api",
          title: "API",
          description: "Implement the API path.",
          verification: "API tests pass.",
          dependsOn: ["inspect"],
        },
        {
          id: "ui",
          title: "UI",
          description: "Implement the UI path.",
          verification: "UI tests pass.",
          dependsOn: ["inspect"],
        },
        {
          id: "verify",
          title: "Verify",
          description: "Run the integrated check.",
          verification: "Full verification passes.",
          dependsOn: ["api", "ui"],
        },
      ],
    });

    expect(plan.phaseWaves).toEqual([
      expect.objectContaining({
        index: 0,
        stepIds: ["inspect"],
        readyStepIds: ["inspect"],
        terminalStepIds: [],
        waveSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      expect.objectContaining({
        index: 1,
        stepIds: ["api", "ui"],
        pendingStepIds: ["api", "ui"],
        readyStepIds: [],
      }),
      expect.objectContaining({
        index: 2,
        stepIds: ["verify"],
        pendingStepIds: ["verify"],
      }),
    ]);
    expect(plan.activePhaseIndex).toBe(0);
    expect(plan.parallelReadyStepIds).toEqual(["inspect"]);

    const inspected = transitionPlanStep(
      transitionPlanStep(plan, "inspect", { action: "start", runId: "run-1" }),
      "inspect",
      { action: "complete", evidence: "Inspection completed." },
    );
    expect(inspected.readyStepIds).toEqual(["api", "ui"]);
    expect(inspected.activePhaseIndex).toBe(1);
    expect(inspected.parallelReadyStepIds).toEqual(["api", "ui"]);
    expect(inspected.phaseWaves[1]).toEqual(
      expect.objectContaining({
        readyStepIds: ["api", "ui"],
        pendingStepIds: [],
      }),
    );

    const apiDone = transitionPlanStep(
      transitionPlanStep(inspected, "api", { action: "start", runId: "run-2" }),
      "api",
      { action: "complete", evidence: "API completed." },
    );
    expect(apiDone.activePhaseIndex).toBe(1);
    expect(apiDone.parallelReadyStepIds).toEqual(["ui"]);
    expect(apiDone.phaseProjectionSha256).not.toBe(
      inspected.phaseProjectionSha256,
    );
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
    const reverified = updateArtifactManifest(verified, "runtime-change", {
      status: "verified",
      sha256: digest,
      sizeBytes: 4_096,
      sourceRunId: "run-4",
      evidence: "The artifact bytes were rechecked.",
    });
    expect(reverified.revision).toBe(verified.revision + 1);
    expect(reverified.artifacts[0]).toEqual(
      expect.objectContaining({
        status: "verified",
        sha256: digest,
        sizeBytes: 4_096,
        sourceRunId: "run-4",
        evidence: "The artifact bytes were rechecked.",
      }),
    );
    expect(
      updateArtifactManifest(reverified, "runtime-change", {
        status: "missing",
        evidence: "Late stale callback.",
      }),
    ).toEqual(reverified);
    const drifted = updateArtifactManifest(reverified, "runtime-change", {
      status: "missing",
      confirmedDrift: true,
      sourceRunId: "run-5",
      evidence: "The verified artifact bytes drifted during recheck.",
    });
    expect(drifted.artifacts[0]).toEqual(
      expect.objectContaining({
        status: "missing",
        sha256: digest,
        sizeBytes: 4_096,
        sourceRunId: "run-5",
        evidence: "The verified artifact bytes drifted during recheck.",
      }),
    );
  });

  it("binds artifact event path and evidence hashes", () => {
    const plan = createDeliveryPlan();
    const produced = updateArtifactManifest(plan, "runtime-change", {
      status: "produced",
      sourceRunId: "run-3",
      evidence: "plans.ts was written by run-3.",
    });
    const artifact = produced.artifacts[0]!;
    const payload = createPlanArtifactEventPayload(produced, artifact);
    expect(payload).toEqual(
      expect.objectContaining({
        pathSha256: sha256Text(artifact.path),
        evidenceSha256: sha256Text(artifact.evidence),
      }),
    );

    const event = planArtifactEvent(produced.threadId, "run-3", 1, payload);
    expect(() =>
      assertPlanArtifactEventBindings({
        plans: [produced],
        events: [event],
        label: "Plan artifact hash binding",
      }),
    ).not.toThrow();

    const tampered = structuredClone(event);
    if (
      !tampered.payload ||
      Array.isArray(tampered.payload) ||
      typeof tampered.payload !== "object"
    ) {
      throw new Error("Artifact event payload fixture is missing");
    }
    tampered.payload["evidenceSha256"] = "0".repeat(64);
    expect(() =>
      assertPlanArtifactEventBindings({
        plans: [produced],
        events: [tampered],
        label: "Plan artifact hash binding",
      }),
    ).toThrow("plan.artifact event binding mismatch");
  });

  it("keeps artifact event bindings stable after later step projection changes", () => {
    const running = transitionPlanStep(createDeliveryPlan(), "inspect", {
      action: "start",
      runId: "run-3",
    });
    const produced = updateArtifactManifest(running, "runtime-change", {
      status: "produced",
      sourceRunId: "run-3",
      evidence: "plans.ts was written by run-3.",
    });
    const verified = updateArtifactManifest(produced, "runtime-change", {
      status: "verified",
      sourceRunId: "run-3",
      sha256: "a".repeat(64),
      sizeBytes: 4_096,
      evidence: "Runtime hashed the artifact bytes.",
    });
    const artifact = verified.artifacts[0]!;
    const event = planArtifactEvent(
      verified.threadId,
      "run-3",
      1,
      createPlanArtifactEventPayload(verified, artifact),
    );
    const completed = transitionPlanStep(verified, "inspect", {
      action: "complete",
      evidence: "Artifact was verified before closing the step.",
    });
    expect(completed.phaseProjectionSha256).not.toBe(
      verified.phaseProjectionSha256,
    );

    expect(() =>
      assertPlanArtifactEventBindings({
        plans: [completed],
        events: [event],
        label: "Plan artifact hash binding",
      }),
    ).not.toThrow();

    const tampered = structuredClone(event);
    if (
      !tampered.payload ||
      Array.isArray(tampered.payload) ||
      typeof tampered.payload !== "object"
    ) {
      throw new Error("Artifact event payload fixture is missing");
    }
    tampered.payload["evidenceSha256"] = "0".repeat(64);
    expect(() =>
      assertPlanArtifactEventBindings({
        plans: [completed],
        events: [tampered],
        label: "Plan artifact hash binding",
      }),
    ).toThrow("plan.artifact event binding mismatch");
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

function planArtifactEvent(
  threadId: string,
  runId: string,
  seq: number,
  payload: { [key: string]: JsonValue },
): RunEvent {
  return {
    id: `event_plan_artifact_${seq}`,
    threadId,
    runId,
    seq,
    type: `plan.artifact.${String(payload["status"])}`,
    category: "plan",
    visibility: "user",
    payload,
    createdAt: "2026-07-29T00:00:00.000Z",
  };
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
