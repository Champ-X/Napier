import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  JsonValue,
  RunEvent,
  ThreadRecord,
  ThreadSummary,
} from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type KernelProjectionDefinition,
  KernelProjectionRegistry,
  TaskNarrativeProjectionService,
  ThreadSummaryProjectionService,
} from "../src/kernel-projections.js";
import {
  ActivePlanProjectionService,
  ConversationActivityEventsProjectionService,
  ConversationArtifactsProjectionService,
  ConversationCitationsProjectionService,
  ConversationMessagesProjectionService,
  OperatorDecisionsProjectionService,
} from "../src/kernel-detail-projections.js";
import { LocalStore } from "../src/store.js";
import {
  createOperatorDecisionAnsweredPayload,
  createOperatorDecisionRequestedPayload,
} from "../src/operator-decisions.js";

const temporaryRoots: string[] = [];
const THREAD_ID = "thread_projection";
const RUN_ID = "run_projection";

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Kernel projection registry", () => {
  it("replays cold state, reuses a warm watermark, and applies only the tail", async () => {
    const registry = new KernelProjectionRegistry();
    const thread = projectionThread();
    const events = [
      event(1, "run.started", { status: "running" }),
      event(2, "message.user", {
        role: "user",
        text: "  Build   the projection.  ",
      }),
    ];
    thread.eventCount = events.length;
    const listEvents = vi.fn(async (_threadId: string, afterSeq = 0) =>
      events.filter((candidate) => candidate.seq > afterSeq),
    );
    const service = new ThreadSummaryProjectionService(registry, {
      getThread: () => structuredClone(thread),
      listThreads: () => [structuredClone(thread)],
      listEvents,
    });

    const cold = await service.project(thread.id);
    expect(cold).toEqual(
      expect.objectContaining({
        stateVersion: 1,
        eventWatermark: 2,
        cacheHit: false,
        appliedEventCount: 2,
        view: expect.objectContaining({
          visible: true,
          summary: expect.objectContaining({
            status: "running",
            lastMessage: "Build the projection.",
            eventCount: 2,
          }),
        }),
      }),
    );

    const warm = await service.project(thread.id);
    expect(warm).toEqual(
      expect.objectContaining({
        eventWatermark: 2,
        cacheHit: true,
        appliedEventCount: 0,
      }),
    );

    events.push(event(3, "run.completed", { status: "completed" }));
    thread.eventCount = events.length;
    const tail = await service.project(thread.id);
    expect(tail).toEqual(
      expect.objectContaining({
        eventWatermark: 3,
        cacheHit: true,
        appliedEventCount: 1,
        view: expect.objectContaining({
          summary: expect.objectContaining({
            status: "idle",
            eventCount: 3,
          }),
        }),
      }),
    );
    expect(listEvents.mock.calls).toEqual([
      [thread.id, 0],
      [thread.id, 2],
      [thread.id, 2],
    ]);
  });

  it("invalidates cached state when a registered projection version increases", async () => {
    const registry = new KernelProjectionRegistry();
    const first = counterProjection(1, 0);
    const second = counterProjection(2, 100);
    const events = [event(1, "projection.incremented", {})];
    registry.register(first);

    await expect(
      registry.project({
        definition: first,
        subjectId: THREAD_ID,
        seed: undefined,
        sourceIdentity: { threadId: THREAD_ID },
        sourceWatermark: 1,
        loadEvents: async (afterSeq) =>
          events.filter((candidate) => candidate.seq > afterSeq),
      }),
    ).resolves.toEqual(expect.objectContaining({ view: 1 }));
    expect(registry.inspect()).toHaveLength(1);

    registry.register(second);
    expect(registry.inspect()).toEqual([]);
    await expect(
      registry.project({
        definition: second,
        subjectId: THREAD_ID,
        seed: undefined,
        sourceIdentity: { threadId: THREAD_ID },
        sourceWatermark: 1,
        loadEvents: async (afterSeq) =>
          events.filter((candidate) => candidate.seq > afterSeq),
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        stateVersion: 2,
        cacheHit: false,
        appliedEventCount: 1,
        view: 101,
      }),
    );
  });

  it("removes owner-scoped definitions and cached state without residue", async () => {
    const registry = new KernelProjectionRegistry();
    const definition = counterProjection(1, 0);
    registry.register(definition, "plugin.fixture");
    await registry.project({
      definition,
      subjectId: THREAD_ID,
      seed: undefined,
      sourceIdentity: { threadId: THREAD_ID },
      sourceWatermark: 1,
      loadEvents: async () => [event(1, "projection.incremented", {})],
    });
    expect(registry.inspect()).toHaveLength(1);

    registry.disposeOwner("plugin.fixture");

    expect(registry.inspect()).toEqual([]);
    await expect(
      registry.project({
        definition,
        subjectId: THREAD_ID,
        seed: undefined,
        sourceIdentity: { threadId: THREAD_ID },
        sourceWatermark: 1,
        loadEvents: async () => [event(1, "projection.incremented", {})],
      }),
    ).rejects.toThrow("not registered");
  });

  it("rejects an incomplete tail instead of caching a false watermark", async () => {
    const registry = new KernelProjectionRegistry();
    const definition = counterProjection(1, 0);
    registry.register(definition);

    await expect(
      registry.project({
        definition,
        subjectId: THREAD_ID,
        seed: undefined,
        sourceIdentity: { threadId: THREAD_ID },
        sourceWatermark: 2,
        loadEvents: async () => [event(1, "projection.incremented", {})],
      }),
    ).rejects.toThrow("watermark mismatch");
    expect(registry.inspect()).toEqual([]);
  });
});

describe("Thread summary projection", () => {
  it("matches the Store summary contract and follows trash visibility by tail replay", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-projection-"));
    temporaryRoots.push(root);
    const store = new LocalStore({
      workspaceRoot: path.join(root, "workspace"),
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const registry = new KernelProjectionRegistry();
    const service = new ThreadSummaryProjectionService(registry, store);
    const thread = store.listThreads()[0]!;

    try {
      expect(await service.listVisible()).toEqual(
        store.listVisibleThreads().map(summaryContract),
      );
      await store.trashThread(thread.id);
      const trashed = await service.project(thread.id);
      expect(trashed).toEqual(
        expect.objectContaining({
          cacheHit: true,
          appliedEventCount: 1,
          view: expect.objectContaining({ visible: false }),
        }),
      );
      expect(await service.listVisible()).toEqual([]);

      await store.restoreThread(thread.id);
      const restored = await service.project(thread.id);
      expect(restored).toEqual(
        expect.objectContaining({
          cacheHit: true,
          appliedEventCount: 1,
          view: expect.objectContaining({ visible: true }),
        }),
      );
      expect(await service.listVisible()).toEqual(
        store.listVisibleThreads().map(summaryContract),
      );
    } finally {
      registry.shutdown();
      store.close();
    }
  });
});

describe("Task narrative projection", () => {
  it("matches canonical detail and replays only the new event tail", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-narrative-"));
    temporaryRoots.push(root);
    const store = new LocalStore({
      workspaceRoot: path.join(root, "workspace"),
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Narrative projection",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const registry = new KernelProjectionRegistry();
    const service = new TaskNarrativeProjectionService(registry, store);

    try {
      const cold = await service.project(thread.id);
      expect(cold).toEqual(
        expect.objectContaining({
          cacheHit: false,
          appliedEventCount: 0,
          view: expect.objectContaining({
            phase: "working",
            currentAction: "Model is preparing the next action",
            metricRunId: run.id,
          }),
        }),
      );
      expect((await store.getDetail(thread.id)).taskNarrative).toEqual(
        cold.view,
      );

      await store.appendEvent({
        threadId: thread.id,
        runId: run.id,
        type: "tool.started",
        category: "tool",
        visibility: "user",
        payload: { callId: "call_search", toolName: "web_search" },
      });
      const tail = await service.project(thread.id);
      expect(tail).toEqual(
        expect.objectContaining({
          cacheHit: true,
          appliedEventCount: 1,
          view: expect.objectContaining({
            phase: "working",
            currentAction: "Running web search",
          }),
        }),
      );
      await expect(service.project(thread.id)).resolves.toEqual(
        expect.objectContaining({
          cacheHit: true,
          appliedEventCount: 0,
          view: tail.view,
        }),
      );
    } finally {
      registry.shutdown();
      store.close();
    }
  });
});

describe("Active Plan projection", () => {
  it("matches canonical detail and advances only on the new event tail", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-active-plan-"));
    temporaryRoots.push(root);
    const store = new LocalStore({
      workspaceRoot: path.join(root, "workspace"),
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Active Plan projection",
      agentId: agent.id,
    });
    const plan = await store.createPlan(thread.id, {
      objective: "Project the active Plan.",
      steps: [
        {
          id: "inspect",
          title: "Inspect",
          description: "Inspect.",
          verification: "Inspected.",
        },
      ],
      artifacts: [
        {
          id: "report",
          path: "report.md",
          description: "Report",
        },
      ],
    });
    const registry = new KernelProjectionRegistry();
    const service = new ActivePlanProjectionService(registry, store);

    try {
      const cold = await service.project(thread.id);
      expect(cold).toEqual(
        expect.objectContaining({
          cacheHit: false,
          appliedEventCount: 0,
          view: expect.objectContaining({
            planId: plan.id,
            stepCount: 1,
            nextStep: expect.objectContaining({ id: "inspect" }),
            eventWatermark: 0,
          }),
        }),
      );
      expect((await store.getDetail(thread.id)).activePlan).toEqual(cold.view);

      await store.appendEvent({
        threadId: thread.id,
        runId: "runctl_plan",
        type: "plan.step.started",
        category: "plan",
        visibility: "user",
        payload: { planId: plan.id, stepId: "inspect" },
      });
      const tail = await service.project(thread.id);
      expect(tail).toEqual(
        expect.objectContaining({
          cacheHit: true,
          appliedEventCount: 1,
          view: expect.objectContaining({
            planId: plan.id,
            eventWatermark: 1,
          }),
        }),
      );
      await expect(service.project(thread.id)).resolves.toEqual(
        expect.objectContaining({
          cacheHit: true,
          appliedEventCount: 0,
          view: tail.view,
        }),
      );
    } finally {
      registry.shutdown();
      store.close();
    }
  });
});

describe("Conversation Messages projection", () => {
  it("matches canonical detail and appends only the new message tail", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-messages-"));
    temporaryRoots.push(root);
    const store = new LocalStore({
      workspaceRoot: path.join(root, "workspace"),
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const thread = store.listThreads()[0]!;
    const runId = store.getThread(thread.id).runIds[0]!;
    const registry = new KernelProjectionRegistry();
    const service = new ConversationMessagesProjectionService(registry, store);

    try {
      const cold = await service.project(thread.id);
      expect(cold).toEqual(
        expect.objectContaining({
          cacheHit: false,
          appliedEventCount: 3,
          view: [
            expect.objectContaining({
              role: "assistant",
              text: expect.stringContaining("durable ledger"),
            }),
          ],
        }),
      );
      expect((await store.getDetail(thread.id)).messages).toEqual(cold.view);

      await store.appendEvent({
        threadId: thread.id,
        runId,
        type: "message.user",
        category: "message",
        visibility: "user",
        payload: { role: "user", text: "Project this message." },
      });
      const tail = await service.project(thread.id);
      expect(tail).toEqual(
        expect.objectContaining({
          cacheHit: true,
          appliedEventCount: 1,
          view: expect.arrayContaining([
            expect.objectContaining({
              role: "user",
              text: "Project this message.",
            }),
          ]),
        }),
      );
      await expect(service.project(thread.id)).resolves.toEqual(
        expect.objectContaining({
          cacheHit: true,
          appliedEventCount: 0,
          view: tail.view,
        }),
      );
    } finally {
      registry.shutdown();
      store.close();
    }
  });
});

describe("Conversation Artifacts projection", () => {
  it("matches canonical detail and updates one artifact tail", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-artifacts-"));
    temporaryRoots.push(root);
    const store = new LocalStore({
      workspaceRoot: path.join(root, "workspace"),
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Artifact projection",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const plan = await store.createPlan(thread.id, {
      objective: "Project the report.",
      steps: [
        {
          id: "ship",
          title: "Ship",
          description: "Ship.",
          verification: "Shipped.",
        },
      ],
      artifacts: [
        {
          id: "report",
          path: "report.md",
          description: "Report",
        },
      ],
    });
    const updated = await store.updatePlanArtifact(plan.id, "report", {
      status: "produced",
      sourceRunId: run.id,
      evidence: "Produced.",
    });
    const registry = new KernelProjectionRegistry();
    const service = new ConversationArtifactsProjectionService(registry, store);

    try {
      await expect(service.project(thread.id)).resolves.toEqual(
        expect.objectContaining({ cacheHit: false, view: [] }),
      );
      await store.appendEvent({
        threadId: thread.id,
        runId: run.id,
        type: "plan.artifact.produced",
        category: "plan",
        visibility: "user",
        payload: {
          planId: plan.id,
          artifactId: "report",
          status: "produced",
        },
      });
      const tail = await service.project(thread.id);
      expect(tail).toEqual(
        expect.objectContaining({
          cacheHit: true,
          appliedEventCount: 1,
          view: [
            expect.objectContaining({
              attemptScope: "current",
              planId: plan.id,
              runId: run.id,
              artifact: expect.objectContaining({
                ...updated.artifacts[0],
                path: "report.md",
              }),
            }),
          ],
        }),
      );
      expect((await store.getDetail(thread.id)).artifacts).toEqual(tail.view);
    } finally {
      registry.shutdown();
      store.close();
    }
  });
});

describe("Conversation Activity Events projection", () => {
  it("retains a bounded latest-call window and applies one event tail", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-activities-"));
    temporaryRoots.push(root);
    const store = new LocalStore({
      workspaceRoot: path.join(root, "workspace"),
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const thread = store.listThreads()[0]!;
    const runId = store.getThread(thread.id).runIds[0]!;
    const registry = new KernelProjectionRegistry();
    const service = new ConversationActivityEventsProjectionService(
      registry,
      store,
    );

    try {
      await expect(service.project(thread.id)).resolves.toEqual(
        expect.objectContaining({ cacheHit: false, view: [] }),
      );
      await store.appendEvent({
        threadId: thread.id,
        runId,
        type: "tool.started",
        category: "tool",
        visibility: "user",
        payload: { callId: "call_read", toolName: "read_file" },
      });
      const tail = await service.project(thread.id);
      expect(tail).toEqual(
        expect.objectContaining({
          cacheHit: true,
          appliedEventCount: 1,
          view: [
            expect.objectContaining({
              type: "tool.started",
              payload: expect.objectContaining({ callId: "call_read" }),
            }),
          ],
        }),
      );
      expect((await store.getDetail(thread.id)).activityEvents).toEqual(
        tail.view,
      );
    } finally {
      registry.shutdown();
      store.close();
    }
  });
});

describe("Conversation Citations projection", () => {
  it("reuses a warm cache and applies one strict citation tail", async () => {
    const registry = new KernelProjectionRegistry();
    const thread = projectionThread();
    const events: RunEvent[] = [];
    const service = new ConversationCitationsProjectionService(registry, {
      getThread: () => structuredClone(thread),
      listEvents: async (_threadId, afterSeq = 0) =>
        events.filter((candidate) => candidate.seq > afterSeq),
    });

    await expect(service.project(thread.id)).resolves.toEqual(
      expect.objectContaining({
        cacheHit: false,
        appliedEventCount: 0,
        view: [],
      }),
    );
    await expect(service.project(thread.id)).resolves.toEqual(
      expect.objectContaining({ cacheHit: true, appliedEventCount: 0 }),
    );

    events.push(citationEvent(1));
    thread.eventCount = 1;
    await expect(service.project(thread.id)).resolves.toEqual(
      expect.objectContaining({
        cacheHit: true,
        appliedEventCount: 1,
        view: [
          expect.objectContaining({
            callId: "call_research",
            citationId: "citation_projection1",
          }),
        ],
      }),
    );
  });
});

describe("Operator Decisions projection", () => {
  it("reuses cached strict decisions and applies one answer tail", async () => {
    const registry = new KernelProjectionRegistry();
    const thread = projectionThread();
    const requested = {
      ...event(
        1,
        "operator.decision.requested",
        createOperatorDecisionRequestedPayload({
          decisionId: "decision_projection1",
          request: {
            header: "Scope",
            question: "Which scope should continue?",
            options: [
              { label: "One", description: "First scope." },
              { label: "Two", description: "Second scope." },
            ],
            multiSelect: false,
          },
        }),
      ),
      category: "system" as const,
    };
    const events = [requested];
    thread.eventCount = 1;
    const service = new OperatorDecisionsProjectionService(registry, {
      getThread: () => structuredClone(thread),
      listEvents: async (_threadId, afterSeq = 0) =>
        events.filter((candidate) => candidate.seq > afterSeq),
    });

    const cold = await service.project(thread.id);
    expect(cold).toEqual(
      expect.objectContaining({
        cacheHit: false,
        appliedEventCount: 1,
        view: [
          expect.objectContaining({
            id: "decision_projection1",
            status: "pending",
          }),
        ],
      }),
    );
    await expect(service.project(thread.id)).resolves.toEqual(
      expect.objectContaining({ cacheHit: true, appliedEventCount: 0 }),
    );

    events.push({
      ...event(
        2,
        "operator.decision.answered",
        createOperatorDecisionAnsweredPayload({
          decision: cold.view[0]!,
          answer: { selectedOptionIds: ["option_1"] },
        }),
      ),
      category: "system",
    });
    thread.eventCount = 2;
    await expect(service.project(thread.id)).resolves.toEqual(
      expect.objectContaining({
        cacheHit: true,
        appliedEventCount: 1,
        view: [expect.objectContaining({ status: "answered" })],
      }),
    );
  });
});

function citationEvent(seq: number): RunEvent {
  return {
    ...event(seq, "tool.completed", {
      callId: "call_research",
      toolName: "research_source",
      status: "completed",
      details: {
        kind: "napier.research-source-evidence",
        schemaVersion: 1,
        action: "cite",
        sourceCount: 1,
        citationCount: 1,
        sourceSetSha256: "1".repeat(64),
        inputContentSha256: "2".repeat(64),
        sourceKind: "web_fetch",
        sourceId: "source_projection1",
        sourceContentSha256: "3".repeat(64),
        sourceUrlSha256: "4".repeat(64),
        sourceOriginSha256: "5".repeat(64),
        sourceTitleSha256: "6".repeat(64),
        sourceTextSha256: "7".repeat(64),
        sourceLineCount: 8,
        sourceTextChars: 1_024,
        sourceTruncated: false,
        webSourceContentSha256: "8".repeat(64),
        webSourceBodySha256: "9".repeat(64),
        webSourceFormat: "html",
        webSourceLineCount: 8,
        webSourceRenderMode: "static",
        browserFallbackStatus: "not_needed",
        citationId: "citation_projection1",
        citationTokenSha256: "a".repeat(64),
        citationStartLine: 2,
        citationEndLine: 4,
        citationQuoteSha256: "b".repeat(64),
        citationClaimSha256: "c".repeat(64),
      },
    }),
    category: "tool",
  };
}

function projectionThread(): ThreadRecord {
  const createdAt = "2026-08-16T00:00:00.000Z";
  return {
    id: THREAD_ID,
    title: "Projection",
    agentId: "agent_projection",
    status: "idle",
    createdAt,
    updatedAt: createdAt,
    lastMessage: "",
    eventCount: 0,
    runIds: [RUN_ID],
  };
}

function event(seq: number, type: string, payload: JsonValue): RunEvent {
  return {
    id: `event_projection_${String(seq)}`,
    threadId: THREAD_ID,
    runId: RUN_ID,
    seq,
    type,
    category: type.startsWith("message.") ? "message" : "lifecycle",
    visibility: "user",
    createdAt: new Date(Date.UTC(2026, 7, 16, 0, 0, seq)).toISOString(),
    payload,
  };
}

function counterProjection(
  version: number,
  initial: number,
): KernelProjectionDefinition<undefined, number, number> {
  return {
    id: "test.counter",
    version,
    init: () => initial,
    apply: (state) => state + 1,
    view: (state) => state,
  };
}

function summaryContract(thread: ThreadSummary): ThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    agentId: thread.agentId,
    status: thread.status,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastMessage: thread.lastMessage,
    eventCount: thread.eventCount,
    ...(thread.goal ? { goal: structuredClone(thread.goal) } : {}),
  };
}
