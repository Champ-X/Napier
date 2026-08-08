import type { RunEvent, ThreadDetail } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { taskNarrative } from "../src/task-narrative-view-model";

describe("Task narrative", () => {
  it("prioritizes operator waiting over run activity", () => {
    const detail = fixture();
    detail.thread.status = "waiting";
    detail.operatorDecisions.push({
      kind: "napier.operator-decision",
      schemaVersion: 1,
      id: "decision_1",
      threadId: detail.thread.id,
      runId: "run_1",
      status: "pending",
      header: "Approve deployment",
      question: "Continue?",
      options: [],
      multiSelect: false,
      questionSha256: "a".repeat(64),
      requestedAt: timestamp(2),
      requestedEventSeq: 2,
      contentSha256: "b".repeat(64),
    });

    expect(taskNarrative(detail)).toEqual(
      expect.objectContaining({
        phase: "waiting",
        phaseLabel: "Waiting",
        currentAction: "Approve deployment",
        blocker: "Operator input is required before the run can continue.",
      }),
    );
  });

  it("shows a blocked plan step and its real blocker", () => {
    const detail = fixture();
    detail.plans.push(plan("blocked", "blocked"));

    expect(taskNarrative(detail)).toEqual(
      expect.objectContaining({
        phase: "blocked",
        currentAction: "Run verification",
        blocker: "Sandbox unavailable",
        completedItems: ["Inspect workspace"],
      }),
    );
  });

  it("shows the running plan step before the latest tool", () => {
    const detail = fixture();
    detail.thread.status = "running";
    detail.thread.currentRunId = "run_1";
    detail.runs.push(run("running"));
    detail.plans.push(plan("active", "running"));
    detail.events.push(toolStarted("run_1", "web_search"));

    expect(taskNarrative(detail)).toEqual(
      expect.objectContaining({
        phase: "working",
        currentAction: "Run verification",
        completedItems: ["Inspect workspace"],
      }),
    );
  });

  it("falls back to the latest visible tool when no plan step is running", () => {
    const detail = fixture();
    detail.thread.status = "running";
    detail.thread.currentRunId = "run_1";
    detail.runs.push(run("running"));
    detail.events.push(toolStarted("run_1", "web_search"));

    expect(taskNarrative(detail)).toEqual(
      expect.objectContaining({
        phase: "working",
        currentAction: "Running web search",
      }),
    );
  });

  it("settles completed work without inventing a percentage", () => {
    const detail = fixture();
    const completed = run("completed");
    completed.startedAt = "2026-08-08T00:00:00.000Z";
    completed.finishedAt = "2026-08-08T00:01:05.000Z";
    completed.usage.inputTokens = 1_000;
    completed.usage.outputTokens = 500;
    completed.usage.costUsd = 0.125;
    completed.limits = {
      maxTurns: 20,
      maxTotalTokens: 10_000,
      maxCostUsd: 2,
      timeoutMs: 120_000,
    };
    detail.runs.push(completed);

    const narrative = taskNarrative(detail);
    expect(narrative).toEqual(
      expect.objectContaining({
        phase: "completed",
        currentAction: "Latest run completed",
        metrics: "1m 5s / 2m 0s · 1,500 / 10,000 tokens · $0.1250 / $2.00",
      }),
    );
    expect(narrative).not.toHaveProperty("progress");
    expect(narrative).not.toHaveProperty("percent");
  });
});

function fixture(): ThreadDetail {
  return {
    thread: {
      id: "thread_1",
      title: "Task",
      agentId: "agent_1",
      status: "idle",
      createdAt: timestamp(0),
      updatedAt: timestamp(0),
      lastMessage: "",
      eventCount: 0,
      runIds: [],
    },
    agent: {
      id: "agent_1",
      name: "Napier",
      description: "",
      systemPrompt: "",
      model: { provider: "napier", id: "demo" },
      thinkingLevel: "off",
      toolPolicy: "observe",
      enabledTools: [],
      enabledSkills: [],
      revision: 1,
      createdAt: timestamp(0),
      updatedAt: timestamp(0),
    },
    runs: [],
    plans: [],
    evaluations: [],
    evaluationAdjudications: [],
    evaluationReviewerBallots: [],
    evaluationConsensusResolutions: [],
    evaluationSuites: [],
    evaluationSuiteExecutions: [],
    automaticRecoveryAssessments: [],
    automaticRecoveryAttempts: [],
    subagents: [],
    runControlMessages: [],
    operatorDecisions: [],
    contextCheckpointCalibration: {
      kind: "napier.context-checkpoint-calibration",
      schemaVersion: 1,
      apiVersion: "2026-07-25",
      threadId: "thread_1",
      eventStreamSha256: "c".repeat(64),
      messageEventCount: 0,
      checkpointCount: 0,
      verifiedCheckpointCount: 0,
      driftedCheckpointCount: 0,
      malformedCheckpointCount: 0,
      failureCount: 0,
      coveredMessageCount: 0,
      coverageRate: 0,
      sourceCharacterCount: 0,
      summaryCharacterCount: 0,
      compressionRatio: 0,
      fallbackOmittedMessageCount: 0,
      samples: [],
      failures: [],
      generatedAt: timestamp(0),
      contentSha256: "d".repeat(64),
    },
    events: [],
  };
}

function run(status: "running" | "completed"): ThreadDetail["runs"][number] {
  return {
    id: "run_1",
    threadId: "thread_1",
    agentId: "agent_1",
    status,
    startedAt: timestamp(1),
    ...(status === "completed" ? { finishedAt: timestamp(3) } : {}),
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
  };
}

function plan(
  status: "active" | "blocked",
  secondStepStatus: "running" | "blocked",
): ThreadDetail["plans"][number] {
  return {
    id: "plan_1",
    threadId: "thread_1",
    objective: "Deliver task",
    status,
    steps: [
      step("inspect", "Inspect workspace", "completed"),
      {
        ...step("verify", "Run verification", secondStepStatus),
        ...(secondStepStatus === "blocked"
          ? { blocker: "Sandbox unavailable" }
          : { runId: "run_1" }),
      },
      step("ship", "Prepare handoff", "ready"),
    ],
    artifacts: [],
    replans: [],
    replanRecommendation: null,
    criticalPathStepIds: ["inspect", "verify", "ship"],
    readyStepIds: ["ship"],
    blockedStepIds: secondStepStatus === "blocked" ? ["verify"] : [],
    phaseWaves: [],
    activePhaseIndex: 1,
    parallelReadyStepIds: ["ship"],
    phaseProjectionSha256: "e".repeat(64),
    revision: 1,
    createdAt: timestamp(0),
    updatedAt: timestamp(2),
  };
}

function step(
  id: string,
  title: string,
  status: "ready" | "running" | "completed" | "blocked",
): ThreadDetail["plans"][number]["steps"][number] {
  return {
    id,
    title,
    description: title,
    verification: "verified",
    dependsOn: [],
    status,
    evidence: status === "completed" ? "done" : "",
    createdAt: timestamp(0),
    updatedAt: timestamp(1),
  };
}

function toolStarted(runId: string, toolName: string): RunEvent {
  return {
    id: "event_tool",
    threadId: "thread_1",
    runId,
    seq: 3,
    type: "tool.started",
    category: "tool",
    visibility: "user",
    createdAt: timestamp(2),
    payload: { toolName },
  };
}

function timestamp(second: number): string {
  return `2026-08-08T00:00:0${String(second)}.000Z`;
}
