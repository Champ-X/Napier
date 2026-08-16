import type {
  ExecutionPlan,
  RunEvent,
  RunRecord,
  ThreadRecord,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { ConversationPlansProjectionService } from "../src/kernel-conversation-plans-projection.js";
import { KernelProjectionRegistry } from "../src/kernel-projections.js";

describe("Kernel Conversation Plans projection", () => {
  it("reuses cached event state, joins Plan updates, and applies one tail", async () => {
    const registry = new KernelProjectionRegistry();
    const thread = projectionThread();
    const plans = [plan("active", "running")];
    const runs = [run()];
    const events = [event(1, "plan.created")];
    thread.eventCount = 1;
    const service = new ConversationPlansProjectionService(registry, {
      getThread: () => structuredClone(thread),
      listEvents: async (_threadId, afterSeq = 0) =>
        events.filter((eventRecord) => eventRecord.seq > afterSeq),
      listPlans: () => structuredClone(plans),
      listRuns: () => structuredClone(runs),
    });

    await expect(service.project(thread.id)).resolves.toEqual(
      expect.objectContaining({
        cacheHit: false,
        appliedEventCount: 1,
        view: [expect.objectContaining({ seq: 1, completedStepCount: 1 })],
      }),
    );

    plans[0] = plan("blocked", "blocked");
    await expect(service.project(thread.id)).resolves.toEqual(
      expect.objectContaining({
        cacheHit: true,
        appliedEventCount: 0,
        view: [
          expect.objectContaining({
            plan: expect.objectContaining({ status: "blocked" }),
            blockedStep: expect.objectContaining({ id: "step_verify" }),
          }),
        ],
      }),
    );

    events.push(event(2, "plan.step.blocked"));
    thread.eventCount = 2;
    await expect(service.project(thread.id)).resolves.toEqual(
      expect.objectContaining({
        cacheHit: true,
        appliedEventCount: 1,
        view: [expect.objectContaining({ seq: 2 })],
      }),
    );
  });
});

function projectionThread(): ThreadRecord {
  return {
    id: "thread_1",
    title: "Plan projection",
    agentId: "agent_1",
    status: "running",
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
    lastMessage: "",
    eventCount: 0,
    runIds: ["run_1"],
  };
}

function plan(
  status: ExecutionPlan["status"],
  verifyStatus: ExecutionPlan["steps"][number]["status"],
): ExecutionPlan {
  return {
    id: "plan_fixture0001",
    threadId: "thread_1",
    objective: "Verify current state",
    status,
    steps: [
      step("step_inspect", "Inspect", "completed"),
      {
        ...step("step_verify", "Verify", verifyStatus),
        ...(verifyStatus === "blocked"
          ? { blocker: "Sandbox unavailable" }
          : { runId: "run_1" }),
      },
    ],
    artifacts: [],
    replans: [],
    replanRecommendation: null,
    criticalPathStepIds: [],
    readyStepIds: [],
    blockedStepIds: verifyStatus === "blocked" ? ["step_verify"] : [],
    phaseWaves: [],
    activePhaseIndex: 0,
    parallelReadyStepIds: [],
    phaseProjectionSha256: "a".repeat(64),
    revision: status === "blocked" ? 2 : 1,
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:02.000Z",
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
    verification: "Verify.",
    dependsOn: [],
    status,
    evidence: status === "completed" ? "Done." : "",
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:01.000Z",
  };
}

function run(): RunRecord {
  return {
    id: "run_1",
    threadId: "thread_1",
    agentId: "agent_1",
    status: "running",
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

function event(seq: number, type: string): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type,
    category: "plan",
    visibility: "user",
    createdAt: `2026-08-16T00:00:0${String(seq)}.000Z`,
    payload: { planId: "plan_fixture0001" },
  };
}
