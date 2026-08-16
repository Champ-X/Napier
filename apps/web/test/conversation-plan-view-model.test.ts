import type { ExecutionPlan, RunEvent, RunRecord } from "@napier/contracts";
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

  it("keeps recovery work current through shared event-bound intent identity", () => {
    const currentPlan = plan("active", "running");
    currentPlan.steps[1]!.runId = "run_interrupted";
    const events = [
      startedEvent(1, "run_interrupted", "intent_delivery0001"),
      eventForRun(2, "run_interrupted", "plan.step.started", {
        planId: currentPlan.id,
        stepId: "step_verify",
      }),
      startedEvent(3, "run_recovery", "intent_delivery0001"),
    ];

    expect(
      conversationPlans(events, [currentPlan], 4, [
        run("run_interrupted", "interrupted"),
        run("run_recovery", "running"),
      ])[0]?.attemptScope,
    ).toBe("current");
  });

  it("marks prior Plan work previous after a newer unrelated intent starts", () => {
    const previousPlan = plan("completed", "completed");
    previousPlan.steps[1]!.runId = "run_previous";
    const events = [
      startedEvent(1, "run_previous", "intent_previous0001"),
      eventForRun(2, "run_previous", "plan.step.completed", {
        planId: previousPlan.id,
        stepId: "step_ship",
      }),
      startedEvent(3, "run_current", "intent_current00001"),
    ];

    expect(
      conversationPlans(events, [previousPlan], 4, [
        run("run_previous", "completed"),
        run("run_current", "running"),
      ])[0]?.attemptScope,
    ).toBe("previous");
  });

  it("uses the server Active Plan summary for compact counts and steps", () => {
    const current = plan("active", "running");
    const projected = {
      planId: current.id,
      revision: current.revision,
      status: current.status,
      objective: current.objective,
      completedStepCount: 9,
      settledStepCount: 10,
      stepCount: 11,
      nextStep: current.steps[2]!,
      verifiedArtifactCount: 7,
      producedArtifactCount: 6,
      missingArtifactCount: 5,
      outputPaths: [],
      activePhaseIndex: 1,
      phaseCount: 2,
      eventWatermark: 2,
    } satisfies NonNullable<import("@napier/contracts").ThreadDetail["activePlan"]>;
    const item = conversationPlans(
      [
        event(2, "plan.step.started", {
          planId: current.id,
          stepId: "step_verify",
        }),
      ],
      [current],
      4,
      [],
      projected,
    )[0]!;

    expect(item).toEqual(
      expect.objectContaining({
        completedStepCount: 9,
        settledStepCount: 10,
        verifiedArtifactCount: 7,
        producedArtifactCount: 6,
        missingArtifactCount: 5,
      }),
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
  return eventForRun(seq, "run_1", type, payload, visibility);
}

function eventForRun(
  seq: number,
  runId: string,
  type: string,
  payload: RunEvent["payload"],
  visibility: RunEvent["visibility"] = "user",
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId,
    seq,
    type,
    category: "plan",
    visibility,
    createdAt: `2026-08-08T00:00:0${String(seq)}.000Z`,
    payload,
  };
}

function startedEvent(seq: number, runId: string, intentId: string): RunEvent {
  return eventForRun(seq, runId, "run.started", { intentId }, "debug");
}

function run(id: string, status: RunRecord["status"]): RunRecord {
  return {
    id,
    threadId: "thread_1",
    agentId: "agent_1",
    status,
    startedAt: `2026-08-08T00:00:0${id === "run_current" || id === "run_recovery" ? "3" : "1"}.000Z`,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
  };
}
