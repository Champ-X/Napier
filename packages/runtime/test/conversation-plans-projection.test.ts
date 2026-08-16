import type { ExecutionPlan, RunEvent, RunRecord } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  applyConversationPlanEvent,
  createConversationPlanEventState,
  projectConversationPlans,
} from "../src/conversation-plans-projection.js";

describe("Conversation Plans projection", () => {
  it("joins authoritative Plan state and drops event/private Plan prose", () => {
    const events = [
      event(1, "plan.created", "run_1", {
        planId: "plan_fixture0001",
        objective: "PRIVATE_EVENT_OBJECTIVE",
      }),
      event(2, "plan.step.started", "run_1", {
        planId: "plan_fixture0001",
        title: "PRIVATE_EVENT_TITLE",
      }),
    ];
    const state = events.reduce(
      applyConversationPlanEvent,
      createConversationPlanEventState(),
    );
    const view = projectConversationPlans(
      [plan("active", "running")],
      [run("run_1", "running")],
      state,
    );

    expect(view).toEqual([
      expect.objectContaining({
        id: "event_2",
        seq: 2,
        attemptScope: "current",
        completedStepCount: 1,
        runningStep: expect.objectContaining({
          id: "step_verify",
          title: "Run verification",
        }),
        plan: expect.objectContaining({
          objective: "Deliver a verified handoff",
          steps: expect.arrayContaining([
            expect.objectContaining({
              id: "step_inspect",
              evidenceRecorded: true,
            }),
          ]),
        }),
      }),
    ]);
    expect(JSON.stringify(view)).not.toContain("PRIVATE_");
    expect(JSON.stringify(view)).not.toContain("Verified by Runtime evidence.");
  });

  it("keeps recovery intent current and marks unrelated prior work previous", () => {
    const currentPlan = plan("active", "running");
    currentPlan.steps[1]!.runId = "run_interrupted";
    const currentEvents = [
      started(1, "run_interrupted", "intent_delivery0001"),
      event(2, "plan.step.started", "run_interrupted", {
        planId: currentPlan.id,
      }),
      started(3, "run_recovery", "intent_delivery0001"),
    ];
    const currentState = currentEvents.reduce(
      applyConversationPlanEvent,
      createConversationPlanEventState(),
    );
    expect(
      projectConversationPlans(
        [currentPlan],
        [run("run_interrupted", "interrupted"), run("run_recovery", "running")],
        currentState,
      )[0]?.attemptScope,
    ).toBe("current");

    const priorPlan = plan("completed", "completed");
    priorPlan.steps[1]!.runId = "run_previous";
    const priorEvents = [
      started(1, "run_previous", "intent_previous0001"),
      event(2, "plan.step.completed", "run_previous", {
        planId: priorPlan.id,
      }),
      started(3, "run_current", "intent_current00001"),
    ];
    const priorState = priorEvents.reduce(
      applyConversationPlanEvent,
      createConversationPlanEventState(),
    );
    expect(
      projectConversationPlans(
        [priorPlan],
        [run("run_previous", "completed"), run("run_current", "running")],
        priorState,
      )[0]?.attemptScope,
    ).toBe("previous");
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
        ...(verifyStatus === "running" ? { runId: "run_1" } : {}),
      },
      step("step_ship", "Prepare handoff", terminal ? "completed" : "ready"),
    ],
    artifacts: [],
    replans: [],
    replanRecommendation: null,
    criticalPathStepIds: [],
    readyStepIds: terminal ? [] : ["step_ship"],
    blockedStepIds: [],
    phaseWaves: [],
    activePhaseIndex: terminal ? null : 0,
    parallelReadyStepIds: terminal ? [] : ["step_ship"],
    phaseProjectionSha256: "a".repeat(64),
    revision: 3,
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:03.000Z",
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
    description: "PRIVATE_STEP_DESCRIPTION",
    verification: "Verified by Runtime evidence.",
    dependsOn: [],
    status,
    evidence: status === "completed" ? "PRIVATE_EVIDENCE" : "",
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:01.000Z",
  };
}

function event(
  seq: number,
  type: string,
  runId: string,
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId,
    seq,
    type,
    category: "plan",
    visibility: "user",
    createdAt: `2026-08-16T00:00:0${String(seq)}.000Z`,
    payload,
  };
}

function started(seq: number, runId: string, intentId: string): RunEvent {
  return {
    ...event(seq, "run.started", runId, { intentId }),
    visibility: "debug",
  };
}

function run(id: string, status: RunRecord["status"]): RunRecord {
  return {
    id,
    threadId: "thread_1",
    agentId: "agent_1",
    status,
    startedAt: "2026-08-16T00:00:00.000Z",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
  };
}
