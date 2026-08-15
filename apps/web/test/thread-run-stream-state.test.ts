import type { RunEvent, StreamFrame, ThreadDetail } from "@napier/contracts";
import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import { describe, expect, it } from "vitest";

import {
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
  threadRunViewState,
  type ThreadRunSessions,
} from "../src/thread-run-stream-state";

describe("Thread Run stream state", () => {
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

function frame(runEvent: RunEvent): StreamFrame {
  return {
    type: "event",
    event: runEvent,
    eventSha256: "c".repeat(64),
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
