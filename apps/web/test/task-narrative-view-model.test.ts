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
        blocker:
          "The run has ended. Record an answer to unlock a linked continuation.",
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

  it("projects paused budget as resumable instead of failed", () => {
    const detail = fixture();
    detail.runs.push({
      ...run("completed"),
      status: "failed",
      outcome: "paused_budget",
      error: "Run budget exhausted.",
    });

    expect(taskNarrative(detail)).toEqual(
      expect.objectContaining({
        phase: "waiting",
        phaseLabel: "Paused",
        currentAction: "Run paused at its budget boundary",
        nextStep: "Continue from the recorded progress.",
      }),
    );
  });

  it("projects preserved partial work with an artifact-first continuation", () => {
    const detail = fixture();
    detail.runs.push({
      ...run("completed"),
      status: "failed",
      outcome: "partial",
      error: "Run budget exhausted.",
    });

    expect(taskNarrative(detail)).toEqual(
      expect.objectContaining({
        phase: "waiting",
        phaseLabel: "Partial",
        currentAction: "Partial result preserved at the budget boundary",
        nextStep: "Continue from preserved artifacts and open work.",
      }),
    );
  });

  it("does not let an older completed run hide interrupted recovery", () => {
    const detail = fixture();
    detail.thread.status = "waiting";
    detail.runs.push(run("completed"), interruptedRun());

    expect(taskNarrative(detail)).toEqual(
      expect.objectContaining({
        phase: "waiting",
        phaseLabel: "Recovering",
        currentAction: "Assessing the interrupted run",
        blocker: "Recovery safety evidence is being evaluated.",
      }),
    );
  });

  it("shows safety-blocked automatic recovery", () => {
    const detail = recoveryFixture();
    detail.automaticRecoveryAssessments.push(
      recoveryAssessment(false, ["unsafe_tool_effect"]),
    );

    expect(taskNarrative(detail)).toEqual(
      expect.objectContaining({
        phase: "blocked",
        phaseLabel: "Recovery blocked",
        currentAction: "Automatic recovery stopped safely",
        blocker: "1 safety condition requires review.",
      }),
    );
  });

  it("shows running and terminal recovery attempts", () => {
    const running = recoveryFixture();
    const assessment = recoveryAssessment(true);
    running.automaticRecoveryAssessments.push(assessment);
    running.automaticRecoveryAttempts.push(recoveryAttempt("running"));
    running.runs.push(recoveryRun("running"));
    running.thread.status = "running";
    running.thread.currentRunId = "run_recovery";

    expect(taskNarrative(running)).toEqual(
      expect.objectContaining({
        phase: "working",
        phaseLabel: "Recovering",
        currentAction: "Restoring from verified read-only evidence",
        nextStep: "Attempt 1/2 is in progress.",
      }),
    );

    const failed = recoveryFixture();
    failed.automaticRecoveryAssessments.push(assessment);
    failed.automaticRecoveryAttempts.push(recoveryAttempt("failed"));
    failed.runs.push(recoveryRun("failed"));
    failed.thread.status = "failed";
    expect(taskNarrative(failed)).toEqual(
      expect.objectContaining({
        phase: "failed",
        phaseLabel: "Recovery failed",
        blocker: "Attempt 1/2 failed.",
      }),
    );

    const completed = recoveryFixture();
    completed.automaticRecoveryAssessments.push(assessment);
    completed.automaticRecoveryAttempts.push(recoveryAttempt("completed"));
    completed.runs.push(recoveryRun("completed"));
    completed.thread.status = "idle";
    expect(taskNarrative(completed)).toEqual(
      expect.objectContaining({
        phase: "completed",
        phaseLabel: "Recovered",
        currentAction: "Interrupted work recovered",
      }),
    );
  });

  it("ignores an old recovery chain after newer work settles", () => {
    const detail = recoveryFixture();
    const assessment = recoveryAssessment(true);
    detail.automaticRecoveryAssessments.push(assessment);
    detail.automaticRecoveryAttempts.push(recoveryAttempt("completed"));
    detail.runs.push(recoveryRun("completed"), {
      ...run("completed"),
      id: "run_newer",
    });
    detail.thread.status = "idle";

    expect(taskNarrative(detail)).toEqual(
      expect.objectContaining({
        phase: "completed",
        phaseLabel: "Settled",
        currentAction: "Latest run completed",
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
    detail.events.push(toolStarted("run_1", "web_search", "call_search", 3));

    expect(taskNarrative(detail)).toEqual(
      expect.objectContaining({
        phase: "working",
        currentAction: "Running web search",
      }),
    );
  });

  it("does not report a settled tool as the current action", () => {
    const detail = fixture();
    detail.thread.status = "running";
    detail.thread.currentRunId = "run_1";
    detail.runs.push(run("running"));
    detail.events.push(
      toolStarted("run_1", "web_search", "call_search", 3),
      toolTerminal("run_1", "web_search", "call_search", "tool.completed", 4),
    );

    expect(taskNarrative(detail)).toEqual(
      expect.objectContaining({
        phase: "working",
        currentAction: "Model is preparing the next action",
      }),
    );
  });

  it("shows grouped completed work for an ad-hoc run without a plan", () => {
    const detail = fixture();
    detail.thread.status = "running";
    detail.thread.currentRunId = "run_1";
    detail.runs.push(run("running"));
    detail.events.push(
      toolStarted("run_1", "read_file", "call_read_1", 3),
      toolTerminal("run_1", "read_file", "call_read_1", "tool.completed", 4),
      toolStarted("run_1", "read_file", "call_read_2", 5),
      toolTerminal("run_1", "read_file", "call_read_2", "tool.completed", 6),
      toolStarted("run_1", "web_search", "call_search", 7),
    );

    expect(taskNarrative(detail)).toEqual(
      expect.objectContaining({
        currentAction: "Running web search",
        completedItems: ["Read 2 files"],
      }),
    );
  });

  it("preserves completed ad-hoc milestones while recovery is assessed", () => {
    const detail = recoveryFixture();
    detail.events.push(
      toolStarted("run_interrupted", "web_fetch", "call_fetch", 3),
      toolTerminal(
        "run_interrupted",
        "web_fetch",
        "call_fetch",
        "tool.completed",
        4,
      ),
    );

    expect(taskNarrative(detail)).toEqual(
      expect.objectContaining({
        phaseLabel: "Recovering",
        completedItems: ["Fetched 1 source"],
      }),
    );
  });

  it("shows the latest unsettled tool when calls overlap", () => {
    const detail = fixture();
    detail.thread.status = "running";
    detail.thread.currentRunId = "run_1";
    detail.runs.push(run("running"));
    detail.events.push(
      toolStarted("run_1", "read_file", "call_read", 3),
      toolStarted("run_1", "web_search", "call_search", 4),
      toolTerminal("run_1", "web_search", "call_search", "tool.failed", 5),
    );

    expect(taskNarrative(detail)).toEqual(
      expect.objectContaining({
        phase: "working",
        currentAction: "Running read file",
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

  it("uses the server projection while formatting live metrics locally", () => {
    const detail = fixture();
    const running = run("running");
    running.startedAt = "2026-08-08T00:00:00.000Z";
    detail.runs.push(running);
    detail.taskNarrative = {
      phase: "working",
      phaseLabel: "Working",
      currentAction: "Projected by Kernel",
      completedItems: ["Read 2 files"],
      metricRunId: running.id,
    };
    detail.events.push(toolStarted(running.id, "web_search"));

    expect(
      taskNarrative(detail, Date.parse("2026-08-08T00:00:05.000Z")),
    ).toEqual(
      expect.objectContaining({
        phase: "working",
        currentAction: "Projected by Kernel",
        completedItems: ["Read 2 files"],
        metrics: expect.stringContaining("5s"),
      }),
    );
  });

  it("adds a concise model Harness summary to the active task", () => {
    const detail = fixture();
    detail.thread.status = "running";
    detail.thread.currentRunId = "run_1";
    detail.runs.push(run("running"));
    detail.events.push(modelHarnessResolved());

    expect(taskNarrative(detail)).toEqual(
      expect.objectContaining({
        harness: {
          family: "openai",
          toolSurface: "focused",
          activeToolCount: 2,
          configuredToolCount: 3,
        },
      }),
    );
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

function interruptedRun(): ThreadDetail["runs"][number] {
  return {
    ...run("completed"),
    id: "run_interrupted",
    status: "interrupted",
    interruptedAt: timestamp(4),
    interruptionReason: "Runtime restarted before settlement.",
  };
}

function recoveryRun(
  status: "running" | "failed" | "completed",
): ThreadDetail["runs"][number] {
  return {
    ...run(status === "running" ? "running" : "completed"),
    id: "run_recovery",
    status,
    source: "recovery",
    parentRunId: "run_interrupted",
    ...(status === "failed" ? { error: "Recovery timeout." } : {}),
  };
}

function recoveryFixture(): ThreadDetail {
  const detail = fixture();
  detail.thread.status = "waiting";
  detail.runs.push(run("completed"), interruptedRun());
  return detail;
}

function recoveryAssessment(
  eligible: boolean,
  blockReasons: ThreadDetail["automaticRecoveryAssessments"][number]["blockReasons"] = [],
): ThreadDetail["automaticRecoveryAssessments"][number] {
  return {
    schemaVersion: 1,
    threadId: "thread_1",
    runId: "run_interrupted",
    rootRunId: "run_interrupted",
    agentId: "agent_1",
    policy: { mode: "safe_read_only", maxAttempts: 2, backoffMs: 1_000 },
    eligible,
    blockReasons,
    toolCalls: {
      total: 1,
      readOnly: eligible ? 1 : 0,
      unsafe: eligible ? 0 : 1,
      unknownEffect: 0,
      unresolved: 0,
    },
    unsafeToolNames: eligible ? [] : ["apply_patch"],
    unknownEffectToolNames: [],
    unresolvedToolNames: [],
    eventRange: {
      fromSeq: 1,
      toSeq: 4,
      eventCount: 4,
      eventStreamSha256: "f".repeat(64),
    },
    priorAttempts: 0,
    eligibleAt: timestamp(4),
    assessedAt: timestamp(4),
    contentSha256: "a".repeat(64),
  };
}

function recoveryAttempt(
  status: ThreadDetail["automaticRecoveryAttempts"][number]["status"],
): ThreadDetail["automaticRecoveryAttempts"][number] {
  return {
    id: "recovery_1",
    threadId: "thread_1",
    agentId: "agent_1",
    rootRunId: "run_interrupted",
    interruptedRunId: "run_interrupted",
    attempt: 1,
    maxAttempts: 2,
    triggerId: "automatic-recovery:run_interrupted:1",
    assessmentSha256: "a".repeat(64),
    status,
    ...(status !== "claimed" ? { recoveryRunId: "run_recovery" } : {}),
    createdAt: timestamp(4),
    updatedAt: timestamp(5),
    revision: 2,
    contentSha256: "b".repeat(64),
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

function toolStarted(
  runId: string,
  toolName: string,
  callId = "call_tool",
  seq = 3,
): RunEvent {
  return {
    id: `event_tool_${String(seq)}`,
    threadId: "thread_1",
    runId,
    seq,
    type: "tool.started",
    category: "tool",
    visibility: "user",
    createdAt: timestamp(2),
    payload: { callId, toolName },
  };
}

function toolTerminal(
  runId: string,
  toolName: string,
  callId: string,
  type: "tool.completed" | "tool.failed" | "tool.blocked",
  seq: number,
): RunEvent {
  return {
    id: `event_terminal_${String(seq)}`,
    threadId: "thread_1",
    runId,
    seq,
    type,
    category: "tool",
    visibility: "user",
    createdAt: timestamp(3),
    payload: { callId, toolName },
  };
}

function modelHarnessResolved(): RunEvent {
  return {
    id: "event_harness",
    threadId: "thread_1",
    runId: "run_1",
    seq: 8,
    type: "model.harness.resolved",
    category: "model",
    visibility: "debug",
    createdAt: timestamp(2),
    payload: {
      kind: "napier.model-harness-resolution",
      schemaVersion: 1,
      harnessId: "napier.model-harness.openai.v1",
      family: "openai",
      promptDialect: "instruction-led",
      provider: "openai",
      model: "gpt-5",
      modelApi: "openai-responses",
      attempt: 1,
      intents: ["coding"],
      toolSurface: "focused",
      configuredToolCount: 3,
      activeToolCount: 2,
      activeToolNames: ["read_file", "apply_patch"],
      omittedToolNames: ["browser"],
      configuredToolDefinitionBytes: 1_000,
      activeToolDefinitionBytes: 300,
      savedToolDefinitionBytes: 700,
      maxRetries: 2,
      maxRetriesSource: "harness",
      maxRetryDelayMs: 30_000,
      maxRetryDelayMsSource: "harness",
      contentSha256: "a".repeat(64),
    },
  };
}

function timestamp(second: number): string {
  return `2026-08-08T00:00:0${String(second)}.000Z`;
}
