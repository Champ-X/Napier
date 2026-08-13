import type { ExecutionPlan, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  conversationPlanEventId,
  conversationPlans,
} from "../src/conversation-plan-view-model";

describe("Conversation plans", () => {
  it("joins timeline events to authoritative Plan state and drops event prose", () => {
    const plans = conversationPlans(
      [
        event(1, "plan.created", {
          planId: "plan_fixture0001",
          objective: "PRIVATE_EVENT_OBJECTIVE",
        }),
        event(2, "plan.step.started", {
          planId: "plan_fixture0001",
          stepId: "step_verify",
          title: "PRIVATE_EVENT_TITLE",
          blocker: "PRIVATE_EVENT_BLOCKER",
        }),
      ],
      [plan("active", "running")],
    );

    expect(plans).toEqual([
      expect.objectContaining({
        id: "event_2",
        seq: 2,
        completedStepCount: 1,
        settledStepCount: 1,
        runningStep: expect.objectContaining({
          id: "step_verify",
          title: "Run verification",
        }),
        nextStep: expect.objectContaining({
          id: "step_ship",
          title: "Prepare handoff",
        }),
        verifiedArtifactCount: 1,
        producedArtifactCount: 1,
        missingArtifactCount: 0,
      }),
    ]);
    expect(JSON.stringify(plans)).not.toContain("PRIVATE_EVENT");
  });

  it("projects real blockers and completed Plan settlement", () => {
    const blocked = conversationPlans(
      [
        event(3, "plan.step.blocked", {
          planId: "plan_fixture0001",
          stepId: "step_verify",
        }),
      ],
      [plan("blocked", "blocked")],
    )[0]!;
    const completed = conversationPlans(
      [
        event(4, "plan.step.completed", {
          planId: "plan_fixture0001",
          stepId: "step_ship",
        }),
      ],
      [plan("completed", "completed")],
    )[0]!;

    expect(blocked.blockedStep).toEqual(
      expect.objectContaining({ blocker: "Sandbox unavailable" }),
    );
    expect(completed.completedStepCount).toBe(3);
    expect(completed.settledStepCount).toBe(3);
    expect(completed.runningStep).toBeUndefined();
    expect(completed.nextStep).toBeUndefined();
  });

  it("filters hidden, malformed, Artifact-only, and unbound Plan events", () => {
    const events = [
      event(1, "plan.created", { planId: "plan_fixture0001" }, "hidden"),
      event(2, "plan.artifact.verified", { planId: "plan_fixture0001" }),
      event(3, "plan.step.started", { planId: "PRIVATE_PLAN" }),
      event(4, "plan.step.started", { planId: "plan_missing0001" }),
      event(5, "plan.step.started", { planId: "plan_fixture0001" }),
    ];
    expect(conversationPlanEventId(events[0]!)).toBeUndefined();
    expect(conversationPlanEventId(events[1]!)).toBeUndefined();
    expect(conversationPlanEventId(events[2]!)).toBeUndefined();
    expect(conversationPlans(events, [plan("active", "running")])).toHaveLength(
      1,
    );
  });
});

function plan(
  status: ExecutionPlan["status"],
  verifyStatus: ExecutionPlan["steps"][number]["status"],
): ExecutionPlan {
  const terminal = status === "completed";
  return {
    id: "plan_fixture0001",
    threadId: "thread_1",
    objective: "Deliver a verified handoff",
    status,
    steps: [
      step("step_inspect", "Inspect workspace", "completed"),
      {
        ...step(
          "step_verify",
          "Run verification",
          terminal ? "completed" : verifyStatus,
        ),
        ...(verifyStatus === "blocked"
          ? { blocker: "Sandbox unavailable" }
          : verifyStatus === "running"
            ? { runId: "run_1" }
            : {}),
      },
      step("step_ship", "Prepare handoff", terminal ? "completed" : "ready"),
    ],
    artifacts: [
      artifact("artifact_report", "verified"),
      artifact("artifact_log", "produced"),
    ],
    replans: [],
    replanRecommendation: null,
    criticalPathStepIds: ["step_inspect", "step_verify", "step_ship"],
    readyStepIds: terminal ? [] : ["step_ship"],
    blockedStepIds: verifyStatus === "blocked" ? ["step_verify"] : [],
    phaseWaves: [],
    activePhaseIndex: terminal ? null : 1,
    parallelReadyStepIds: terminal ? [] : ["step_ship"],
    phaseProjectionSha256: "a".repeat(64),
    revision: 3,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:03.000Z",
  };
}

function step(
  id: string,
  title: string,
  status: ExecutionPlan["steps"][number]["status"],
): ExecutionPlan["steps"][number] {
  return {
    id,
    title,
    description: title,
    verification: "Verified by Runtime evidence.",
    dependsOn: [],
    status,
    evidence: status === "completed" ? "Evidence recorded." : "",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:01.000Z",
  };
}

function artifact(
  id: string,
  status: ExecutionPlan["artifacts"][number]["status"],
): ExecutionPlan["artifacts"][number] {
  return {
    id,
    path: `artifacts/${id}.txt`,
    kind: "file",
    description: id,
    status,
    evidence: "Runtime evidence.",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:01.000Z",
  };
}

function event(
  seq: number,
  type: string,
  payload: RunEvent["payload"],
  visibility: RunEvent["visibility"] = "user",
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type,
    category: "plan",
    visibility,
    createdAt: `2026-08-08T00:00:0${String(seq)}.000Z`,
    payload,
  };
}
