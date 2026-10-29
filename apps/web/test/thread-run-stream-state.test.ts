import type { RunEvent, StreamFrame, ThreadDetail } from "@napier/contracts";
import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import { describe, expect, it } from "vitest";

import {
  activateThreadDetail,
  activeRunStreamingText,
  applyThreadRunEvent,
  applyThreadStreamFrameToBootstrap,
  applyThreadStreamFrameToDetail,
  attachThreadRun,
  detachThreadRun,
  mergeBackgroundBootstrap,
  mergeNavigationBootstrap,
  mergeBackgroundThreadDetail,
  mergeRefreshedThreadBootstrap,
  removeThreadDetail,
  threadRunViewState,
  type ThreadRunSessions,
} from "../src/thread-run-stream-state";

describe("Thread Run stream state", () => {
  it("activates a locally returned Thread without replacing static bootstrap catalogs", () => {
    const current = bootstrap(
      detail("thread_a", []),
      summary("thread_a", "idle", 2),
    );
    const created = detail("thread_b", []);

    const updated = activateThreadDetail(current, created);

    expect(updated.activeThread?.thread.id).toBe("thread_b");
    expect(updated.threads.map((thread) => thread.id)).toContain("thread_b");
    expect(updated.models).toBe(current.models);
    expect(updated.skills).toBe(current.skills);
  });

  it("removes a Thread optimistically and activates a cached successor", () => {
    const current = bootstrap(
      detail("thread_a", []),
      summary("thread_a", "idle", 2),
      summary("thread_b", "idle", 1),
    );
    const next = detail("thread_b", []);

    const updated = removeThreadDetail(current, "thread_a", next);

    expect(updated.threads.map((thread) => thread.id)).toEqual(["thread_b"]);
    expect(updated.activeThread?.thread.id).toBe("thread_b");
  });

  it("keeps simultaneous Thread streams isolated", () => {
    let sessions: ThreadRunSessions = {};
    sessions = attachThreadRun(sessions, "thread_a");
    sessions = attachThreadRun(sessions, "thread_b");
    sessions = applyThreadRunEvent(
      sessions,
      "thread_a",
      event("thread_a", "run_a", 1, "A"),
    );
    sessions = applyThreadRunEvent(
      sessions,
      "thread_b",
      event("thread_b", "run_b", 1, "B"),
    );
    sessions = applyThreadRunEvent(
      sessions,
      "thread_a",
      event("thread_a", "run_a", 2, "2"),
    );

    expect(sessions).toEqual({
      thread_a: { runId: "run_a", streamingText: "A2" },
      thread_b: { runId: "run_b", streamingText: "B" },
    });
    expect(detachThreadRun(sessions, "thread_a")).toEqual({
      thread_b: { runId: "run_b", streamingText: "B" },
    });
    expect(threadRunViewState(detail("thread_b", []), sessions)).toEqual({
      activeRunId: "run_b",
      isRunning: true,
      streamingText: "B",
    });
  });

  it("projects durable partial output when a running Thread is reopened", () => {
    const events = [
      event("thread_a", "run_old", 1, "old"),
      assistant("thread_a", "run_old", 2),
      event("thread_a", "run_active", 3, "Hello "),
      event("thread_a", "run_active", 4, "world"),
    ];

    expect(activeRunStreamingText(events, "run_active")).toBe("Hello world");
    expect(activeRunStreamingText(events, "run_old")).toBe("");
  });

  it("retains child lifecycle, route and tool events without replacing the primary stream owner", () => {
    const threadId = "thread_a";
    const parentId = "run_parent";
    const childId = "run_child";
    const started = (runId: string, seq: number, source: "user" | "subagent"): RunEvent => ({
      ...event(threadId, runId, seq, ""), type: "run.started", category: "lifecycle",
      payload: { source, ...(source === "subagent" ? { parentRunId: parentId, taskId: "task_child" } : {}) },
    });
    const childEvents: RunEvent[] = [
      started(childId, 3, "subagent"),
      { ...event(threadId, childId, 4, ""), type: "route_plan_created", category: "model",
        payload: { id: "route_child", runId: childId, subagentRole: "researcher" } },
      { ...event(threadId, childId, 5, ""), type: "tool.started", category: "tool",
        payload: { callId: "call_child", toolName: "web_fetch", taskId: "task_child" } },
      modelResponse(threadId, childId, 6),
      { ...event(threadId, childId, 7, ""), type: "run.completed", category: "lifecycle", payload: { status: "completed" } },
    ];
    let sessions = attachThreadRun({}, threadId);
    let current = detail(threadId, []);
    let boot = bootstrap(current, current.thread);
    const events = [started(parentId, 1, "user"), event(threadId, parentId, 2, "Parent pending"), ...childEvents];
    for (const next of events) {
      sessions = applyThreadRunEvent(sessions, threadId, next);
      current = applyThreadStreamFrameToDetail(current, threadId, frame(next))!;
      boot = applyThreadStreamFrameToBootstrap(boot, threadId, frame(next))!;
    }
    expect(sessions[threadId]).toEqual({ runId: parentId, streamingText: "Parent pending" });
    expect(current.thread.currentRunId).toBe(parentId);
    expect(boot.activeThread?.thread.currentRunId).toBe(parentId);
    expect(current.events.filter((item) => item.runId === childId)).toEqual(childEvents);
    expect(activeRunStreamingText(current.events, parentId)).toBe("Parent pending");
    const completed: RunEvent = { ...event(threadId, parentId, 8, ""),
      type: "run.completed", category: "lifecycle", payload: { status: "completed" } };
    sessions = applyThreadRunEvent(sessions, threadId, completed);
    expect(sessions[threadId]).toEqual({ runId: parentId, streamingText: "" });
    expect(activeRunStreamingText([...current.events, completed], parentId)).toBe("");
    const snapshot = { ...current, events: [...current.events, completed],
      runs: [parentId, childId].map((id) => ({ id, threadId, agentId: "agent", status: "completed" as const,
        source: id === childId ? "subagent" as const : "user" as const,
        ...(id === childId ? { parentRunId: parentId } : {}),
        startedAt: "2026-08-07T00:00:00.000Z", finishedAt: "2026-08-07T00:00:08.000Z",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
      })) };
    const snapshotFrame: StreamFrame = { type: "snapshot", detail: snapshot,
      detailSha256: "f".repeat(64), detailBytes: 1, eventBytes: 1 };
    const restored = applyThreadStreamFrameToDetail(current, threadId, snapshotFrame)!;
    expect(restored.runs.map((run) => run.id)).toEqual([parentId, childId]);
    expect(restored.thread.currentRunId).toBe(parentId);
    expect(applyThreadStreamFrameToBootstrap(boot, threadId, snapshotFrame)?.activeThread?.runs).toEqual(snapshot.runs);
    expect(threadRunViewState(restored, detachThreadRun(sessions, threadId))).toEqual({
      activeRunId: undefined, isRunning: false, streamingText: "",
    });
  });

  it("accepts a new primary recovery start while ignoring a child start before attachment", () => {
    let sessions = attachThreadRun({}, "thread_a");
    sessions = applyThreadRunEvent(sessions, "thread_a", { ...event("thread_a", "run_child", 1, ""),
      type: "run.started", category: "lifecycle", payload: { source: "subagent", parentRunId: "run_parent" } });
    expect(sessions.thread_a).toEqual({ streamingText: "" });
    sessions = applyThreadRunEvent(sessions, "thread_a", event("thread_a", "run_parent", 2, "Before recovery"));
    sessions = applyThreadRunEvent(sessions, "thread_a", { ...event("thread_a", "run_recovery", 3, ""),
      type: "run.started", category: "lifecycle", payload: { source: "recovery", parentRunId: "run_parent" } });
    sessions = applyThreadRunEvent(sessions, "thread_a", event("thread_a", "run_recovery", 4, "Recovered"));
    expect(sessions.thread_a).toEqual({ runId: "run_recovery", streamingText: "Recovered" });
  });

  it("hands intermediate tool-calling text to progress notes without concatenating rounds", () => {
    const events = [
      event("thread_a", "run_active", 1, "先检查结构"),
      modelResponse("thread_a", "run_active", 2),
      event("thread_a", "run_active", 3, "再修改样式"),
    ];

    let sessions: ThreadRunSessions = attachThreadRun({}, "thread_a");
    for (const runEvent of events) {
      sessions = applyThreadRunEvent(sessions, "thread_a", runEvent);
    }

    expect(sessions.thread_a?.streamingText).toBe("再修改样式");
    expect(activeRunStreamingText(events, "run_active")).toBe("再修改样式");
  });

  it("retracts a streamed capability blocker as soon as recovery is required", () => {
    const events = [
      event("thread_a", "run_active", 1, "工具均不可用"),
      capabilityRecoveryResponse("thread_a", "run_active", 2),
    ];

    let sessions: ThreadRunSessions = attachThreadRun({}, "thread_a");
    for (const runEvent of events) {
      sessions = applyThreadRunEvent(sessions, "thread_a", runEvent);
    }

    expect(sessions.thread_a?.streamingText).toBe("");
    expect(activeRunStreamingText(events, "run_active")).toBe("");
  });

  it("does not append a background Thread event to the selected detail", () => {
    const selected = detail("thread_b", []);
    const backgroundFrame = frame(event("thread_a", "run_a", 1, "A"));

    expect(
      applyThreadStreamFrameToDetail(selected, "thread_a", backgroundFrame),
    ).toBe(selected);

    const bootstrap = {
      apiVersion: "2026-07-25",
      workspace: {
        root: "/workspace",
        dataRoot: "/workspace/.napier",
        localFirst: true as const,
        isolation: "workspace" as const,
      },
      recommendedRunModel: { provider: "napier", id: "demo" },
      agents: [],
      threads: [selected.thread, detail("thread_a", []).thread],
      skills: [],
      models: [],
      memories: [],
      extensions: [],
      extensionPublisherTrustAnchors: [],
      extensionPackageRolloutChannels: [],
      skillPackageInstallations: [],
      credentials: [],
      usagePriceTableCatalog: {
        kind: "napier.usage-price-table-catalog" as const,
        schemaVersion: 1 as const,
        apiVersion: "2026-07-25",
        generatedAt: "1970-01-01T00:00:00.000Z",
        tables: [],
        contentSha256: "a".repeat(64),
      },
      schedules: [],
      channels: [],
      inboundChannelAdapters: [],
      inboundChannelAdapterCatalogSha256: "b".repeat(64),
      activeThread: selected,
    };
    const updated = applyThreadStreamFrameToBootstrap(
      bootstrap,
      "thread_a",
      backgroundFrame,
    );

    expect(updated?.activeThread).toBe(selected);
    expect(updated?.threads.find((thread) => thread.id === "thread_a")).toEqual(
      expect.objectContaining({ status: "running", eventCount: 1 }),
    );
  });

  it("applies the server Task Narrative with a live event frame", () => {
    const current = detail("thread_a", []);
    const runEvent = event("thread_a", "run_a", 1, "A");
    const updated = applyThreadStreamFrameToDetail(current, "thread_a", {
      ...frame(runEvent),
      projections: {
        taskNarrative: {
          phase: "working",
          phaseLabel: "Working",
          currentAction: "Running web search",
          completedItems: [],
          metricRunId: "run_a",
        },
        activePlan: {
          planId: "plan_fixture0001",
          revision: 1,
          status: "active",
          objective: "Project plan",
          completedStepCount: 0,
          settledStepCount: 0,
          stepCount: 1,
          verifiedArtifactCount: 0,
          producedArtifactCount: 0,
          missingArtifactCount: 0,
          outputPaths: [],
          activePhaseIndex: 0,
          phaseCount: 1,
          eventWatermark: 1,
        },
        messages: [
          {
            id: "event_message",
            seq: 1,
            role: "user",
            text: "Projected message",
            model: "",
            createdAt: "2026-08-07T00:00:01.000Z",
          },
        ],
        conversationPlans: [
          {
            id: "event_plan",
            seq: 1,
            createdAt: "2026-08-07T00:00:01.000Z",
            attemptScope: "current",
            plan: {
              id: "plan_fixture0001",
              status: "active",
              revision: 1,
              objective: "Project plan",
              steps: [],
              activePhaseIndex: 0,
              phaseCount: 1,
            },
            completedStepCount: 0,
            settledStepCount: 0,
            verifiedArtifactCount: 0,
            producedArtifactCount: 0,
            missingArtifactCount: 0,
          },
        ],
        artifacts: [
          {
            id: "event_artifact",
            seq: 1,
            createdAt: "2026-08-07T00:00:01.000Z",
            attemptScope: "current",
            threadId: "thread_a",
            runId: "run_a",
            planId: "plan_fixture0001",
            planRevision: 1,
            artifact: {
              id: "report",
              path: "report.md",
              kind: "file",
              description: "Report",
              status: "verified",
              evidence: "Verified.",
              createdAt: "2026-08-07T00:00:00.000Z",
              updatedAt: "2026-08-07T00:00:01.000Z",
            },
          },
        ],
        activityEvents: [
          {
            id: "event_tool",
            threadId: "thread_a",
            runId: "run_a",
            seq: 1,
            type: "tool.started",
            category: "tool",
            visibility: "user",
            createdAt: "2026-08-07T00:00:01.000Z",
            payload: { callId: "call_read", toolName: "read_file" },
          },
        ],
        activityCandidates: [
          {
            id: "event_activity",
            seq: 1,
            type: "run.no_progress",
            label: "Run",
            summary: "Run no progress",
            tone: "info",
            createdAt: "2026-08-07T00:00:01.000Z",
          },
        ],
        citations: [
          {
            id: "event_citation",
            seq: 1,
            createdAt: "2026-08-07T00:00:01.000Z",
            callId: "call_research",
            citationId: "citation_fixture0001",
            sourceId: "source_fixture0001",
            sourceKind: "web_fetch",
            startLine: 2,
            endLine: 4,
            sourceContentSha256: "1".repeat(64),
            sourceTitleSha256: "2".repeat(64),
            quoteSha256: "3".repeat(64),
            claimSha256: "4".repeat(64),
          },
        ],
        recoveries: [
          {
            id: "run_interrupted0001",
            seq: 1,
            createdAt: "2026-08-07T00:00:01.000Z",
            status: "skipped",
            assessment: {
              contentSha256: "5".repeat(64),
              interruptedRunId: "run_interrupted0001",
              rootRunId: "run_interrupted0001",
              eligible: false,
              blockReasons: ["unsafe_tool_effect"],
              policy: {
                mode: "safe_read_only",
                maxAttempts: 2,
                backoffMs: 1_000,
              },
              toolCalls: {
                total: 1,
                readOnly: 0,
                unsafe: 1,
                unknownEffect: 0,
                unresolved: 0,
              },
              eventRange: {
                fromSeq: 1,
                toSeq: 1,
                eventCount: 1,
                eventStreamSha256: "6".repeat(64),
              },
              priorAttempts: 0,
              assessedAt: "2026-08-07T00:00:01.000Z",
            },
            eventIds: ["event_recovery"],
          },
        ],
        subagentCards: [
          {
            id: "event_subagent",
            seq: 1,
            createdAt: "2026-08-07T00:00:01.000Z",
            task: {
              id: "task_fixture0001",
              role: "reviewer",
              description: "Review projected evidence",
              status: "completed",
              model: { provider: "napier", id: "demo" },
              stepCount: 2,
              turnCount: 1,
              usage: { inputTokens: 100, outputTokens: 20 },
              stopReason: "completed",
              outcome: {
                summary: "Projected evidence is complete.",
                items: [],
              },
            },
            itemCount: 0,
            evidenceCount: 0,
            unknownCount: 0,
            blockerCount: 0,
            warningCount: 0,
          },
        ],
        subagentHub: hubProjection("thread_a"),
        operatorDecisions: [],
      },
    });

    expect(updated?.taskNarrative).toEqual(
      expect.objectContaining({
        phase: "working",
        currentAction: "Running web search",
      }),
    );
    expect(updated?.activePlan?.planId).toBe("plan_fixture0001");
    expect(updated?.messages?.[0]?.text).toBe("Projected message");
    expect(updated?.conversationPlans?.[0]?.plan.id).toBe("plan_fixture0001");
    expect(updated?.artifacts?.[0]?.artifact.path).toBe("report.md");
    expect(updated?.activityEvents?.[0]?.type).toBe("tool.started");
    expect(updated?.activityCandidates?.[0]?.type).toBe("run.no_progress");
    expect(updated?.citations?.[0]?.callId).toBe("call_research");
    expect(updated?.recoveries?.[0]?.status).toBe("skipped");
    expect(updated?.subagentCards?.[0]?.task.status).toBe("completed");
    expect(updated?.subagentHub?.tasks[0]?.description).toBe(
      "Review projected evidence",
    );
  });

  it("does not roll back another Thread when concurrent final refreshes arrive out of order", () => {
    const current = bootstrap(
      detail("thread_b", []),
      summary("thread_a", "idle", 20),
      summary("thread_b", "running", 10),
    );
    const staleForB = bootstrap(
      detail("thread_b", []),
      summary("thread_a", "running", 5),
      summary("thread_b", "idle", 30),
    );

    const merged = mergeRefreshedThreadBootstrap(
      current,
      staleForB,
      "thread_b",
    );

    expect(merged.threads.find((thread) => thread.id === "thread_a")).toEqual(
      expect.objectContaining({ status: "idle", eventCount: 20 }),
    );
    expect(merged.threads.find((thread) => thread.id === "thread_b")).toEqual(
      expect.objectContaining({ status: "idle", eventCount: 30 }),
    );
  });

  it("does not replace the selected Thread with a background detail refresh", () => {
    const selected = detail("thread_b", []);
    const background = {
      ...detail("thread_a", []),
      thread: summary("thread_a", "waiting", 42),
    };
    const current = bootstrap(selected, background.thread, selected.thread);

    const merged = mergeBackgroundThreadDetail(current, background);

    expect(merged?.activeThread?.thread.id).toBe("thread_b");
    expect(merged?.threads.find((thread) => thread.id === "thread_a")).toEqual(
      expect.objectContaining({ status: "waiting", eventCount: 42 }),
    );
  });

  it("does not replace the selected Thread with a background configuration refresh", () => {
    const selected = detail("thread_b", []);
    const background = detail("thread_a", []);
    const current = bootstrap(selected, background.thread, selected.thread);
    const incoming = {
      ...bootstrap(background, background.thread, selected.thread),
      recommendedRunModel: { provider: "provider", id: "new-model" },
    };

    const merged = mergeBackgroundBootstrap(current, incoming);

    expect(merged.activeThread?.thread.id).toBe("thread_b");
    expect(merged.recommendedRunModel).toEqual(incoming.recommendedRunModel);
  });

  it("preserves newer background summaries when a navigation response is stale", () => {
    const current = bootstrap(
      detail("thread_a", []),
      summary("thread_a", "running", 20),
      summary("thread_b", "idle", 10),
    );
    const staleNavigation = bootstrap(
      detail("thread_b", []),
      summary("thread_a", "idle", 5),
      summary("thread_b", "idle", 10),
    );

    const merged = mergeNavigationBootstrap(current, staleNavigation);

    expect(merged.activeThread?.thread.id).toBe("thread_b");
    expect(merged.threads.find((thread) => thread.id === "thread_a")).toEqual(
      expect.objectContaining({ status: "running", eventCount: 20 }),
    );
  });
});

function event(
  threadId: string,
  runId: string,
  seq: number,
  delta: string,
): RunEvent {
  return {
    id: `event_${threadId}_${seq}`,
    threadId,
    runId,
    seq,
    type: "model.text.delta",
    category: "model",
    visibility: "hidden",
    createdAt: `2026-08-07T00:00:0${seq}.000Z`,
    payload: { delta },
  };
}

function assistant(threadId: string, runId: string, seq: number): RunEvent {
  return {
    ...event(threadId, runId, seq, ""),
    type: "message.assistant",
    category: "message",
    visibility: "user",
    payload: { role: "assistant", text: "done" },
  };
}

function modelResponse(threadId: string, runId: string, seq: number): RunEvent {
  return {
    ...event(threadId, runId, seq, ""),
    type: "model.response",
    visibility: "debug",
    payload: {
      text: "先检查结构",
      toolCalls: [{ id: "call_read", name: "read_file" }],
    },
  };
}

function capabilityRecoveryResponse(
  threadId: string,
  runId: string,
  seq: number,
): RunEvent {
  return {
    ...event(threadId, runId, seq, ""),
    type: "model.response",
    visibility: "debug",
    payload: {
      text: "工具均不可用",
      toolCalls: [],
      responseDisposition: "capability_recovery_required",
    },
  };
}

function frame(runEvent: RunEvent): Extract<StreamFrame, { type: "event" }> {
  return {
    type: "event",
    event: runEvent,
    eventSha256: "c".repeat(64),
  };
}

function hubProjection(threadId: string) {
  return {
    kind: "napier.subagent-hub-projection" as const,
    schemaVersion: 1 as const,
    threadId,
    taskCount: 1,
    selectedTaskCount: 1,
    activeTaskCount: 0,
    terminalTaskCount: 1,
    orphanedTaskCount: 0,
    omittedTaskCount: 0,
    eventWatermark: 1,
    tasks: [
      {
        taskId: "task_fixture0001",
        runId: "run_thread_a",
        role: "reviewer" as const,
        description: "Review projected evidence",
        status: "completed" as const,
        taskStatus: "completed" as const,
        model: { provider: "napier", id: "demo" },
        stepCount: 2,
        turnCount: 1,
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
        },
        revision: 3,
        createdAt: "2026-08-07T00:00:00.000Z",
        mailbox: { acceptedCount: 0, deliveredCount: 0, pendingCount: 0 },
        lineage: { childTaskIds: [] },
        transcript: [],
        worktree: { state: "none" as const },
        control: {
          steer: false,
          cancel: false,
          revive: false,
          unavailableReason: "parent_run_not_running" as const,
        },
      },
    ],
  };
}

function detail(threadId: string, events: RunEvent[]): ThreadDetail {
  const runId = `run_${threadId}`;
  return {
    thread: {
      id: threadId,
      title: threadId,
      agentId: "agent",
      status: "waiting",
      createdAt: "2026-08-07T00:00:00.000Z",
      updatedAt: "2026-08-07T00:00:00.000Z",
      lastMessage: "",
      eventCount: events.length,
      runIds: [runId],
    },
    agent: {
      id: "agent",
      name: "Agent",
      description: "",
      systemPrompt: "",
      model: { provider: "napier", id: "demo" },
      thinkingLevel: "off",
      toolPolicy: "observe",
      enabledTools: [],
      enabledSkills: [],
      revision: 1,
      createdAt: "2026-08-07T00:00:00.000Z",
      updatedAt: "2026-08-07T00:00:00.000Z",
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
      threadId,
      eventStreamSha256: "d".repeat(64),
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
      generatedAt: "2026-08-07T00:00:00.000Z",
      contentSha256: "e".repeat(64),
    },
    events,
  };
}

function summary(
  threadId: string,
  status: ThreadDetail["thread"]["status"],
  eventCount: number,
): ThreadDetail["thread"] {
  return {
    ...detail(threadId, []).thread,
    status,
    eventCount,
    updatedAt: `2026-08-07T00:00:${String(eventCount).padStart(2, "0")}.000Z`,
  };
}

function bootstrap(
  activeThread: ThreadDetail,
  ...threads: ThreadDetail["thread"][]
): LiveReadyBootstrapResponse {
  return {
    apiVersion: "2026-07-25",
    workspace: {
      root: "/workspace",
      dataRoot: "/workspace/.napier",
      localFirst: true,
      isolation: "workspace",
    },
    recommendedRunModel: { provider: "napier", id: "demo" },
    agents: [],
    threads,
    skills: [],
    models: [],
    memories: [],
    extensions: [],
    extensionPublisherTrustAnchors: [],
    extensionPackageRolloutChannels: [],
    skillPackageInstallations: [],
    credentials: [],
    usagePriceTableCatalog: {
      kind: "napier.usage-price-table-catalog",
      schemaVersion: 1,
      apiVersion: "2026-07-25",
      generatedAt: "1970-01-01T00:00:00.000Z",
      tables: [],
      contentSha256: "a".repeat(64),
    },
    schedules: [],
    channels: [],
    inboundChannelAdapters: [],
    inboundChannelAdapterCatalogSha256: "b".repeat(64),
    activeThread,
  };
}
