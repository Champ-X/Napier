import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalStore } from "../src/store.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createStore(): Promise<LocalStore> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-store-"));
  temporaryRoots.push(root);
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  });
  await store.initialize();
  return store;
}

describe("LocalStore", () => {
  it("seeds a replayable onboarding ledger", async () => {
    const store = await createStore();
    const [thread] = store.listThreads();
    expect(thread).toBeDefined();
    const detail = await store.getDetail(thread!.id);
    expect(detail.events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(detail.runs[0]?.status).toBe("completed");
    expect(detail.runs[0]?.configuration).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        agentRevision: detail.agent.revision,
        automaticRecovery: {
          mode: "manual",
          maxAttempts: 2,
          backoffMs: 5_000,
        },
        executionMode: "standard",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(detail.runs[0]?.configuration)).not.toContain(
      detail.agent.systemPrompt,
    );
  });

  it("persists Agent revision history and rolls back through a new revision", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-store-"));
    temporaryRoots.push(root);
    const options = {
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    };
    const store = new LocalStore(options);
    await store.initialize();
    const original = store.listAgents()[0]!;
    expect(store.listAgentRevisions(original.id)).toEqual([
      expect.objectContaining({
        revision: 1,
        source: "created",
        profile: original,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);

    const updated = await store.updateAgent(original.id, {
      name: "Revisioned Napier",
      systemPrompt: "Preserve every revision as durable evidence.",
      toolPolicy: "workspace",
    });
    expect(updated.revision).toBe(2);
    expect(store.listAgentRevisions(original.id)).toEqual([
      expect.objectContaining({
        revision: 2,
        source: "updated",
        changedFields: ["name", "systemPrompt", "toolPolicy"],
      }),
      expect.objectContaining({ revision: 1, source: "created" }),
    ]);

    await store.updateAgent(original.id, { name: "Revisioned Napier" });
    expect(store.listAgentRevisions(original.id)).toHaveLength(2);

    const rollback = await store.rollbackAgent(original.id, 1);
    expect(rollback.agent).toEqual(
      expect.objectContaining({
        name: original.name,
        systemPrompt: original.systemPrompt,
        toolPolicy: original.toolPolicy,
        revision: 3,
      }),
    );
    expect(rollback.revision).toEqual(
      expect.objectContaining({
        revision: 3,
        source: "rollback",
        restoredFromRevision: 1,
        profile: rollback.agent,
      }),
    );
    expect(store.getAgentRevision(original.id, 3)).toEqual(rollback.revision);

    store.close();
    const reopened = new LocalStore(options);
    await reopened.initialize();
    expect(reopened.getAgent(original.id)).toEqual(rollback.agent);
    expect(reopened.listAgentRevisions(original.id)).toEqual([
      rollback.revision,
      expect.objectContaining({ revision: 2, source: "updated" }),
      expect.objectContaining({ revision: 1, source: "created" }),
    ]);
    reopened.close();
  });

  it("persists append-only evaluation adjudication and protects reviewed evidence from retention", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-store-"));
    temporaryRoots.push(root);
    const options = {
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    };
    const store = new LocalStore(options);
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Reviewed evaluation evidence",
      agentId: agent.id,
    });
    const left = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    await store.finishRun(left.id, "completed");
    const right = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    await store.finishRun(right.id, "completed");
    const evaluation = await store.saveRunEvaluation({
      id: "evaluation_reviewed_evidence",
      threadId: thread.id,
      leftRunId: left.id,
      rightRunId: right.id,
      leftSnapshotSha256: "a".repeat(64),
      rightSnapshotSha256: "b".repeat(64),
      rubric: {
        name: "Release evidence",
        criteria: [
          {
            id: "correctness",
            name: "Correctness",
            description: "The outcome is grounded in evidence.",
          },
        ],
      },
      scores: [
        {
          criterionId: "correctness",
          leftScore: 3,
          rightScore: 4,
          reason: "The candidate has stronger evidence.",
        },
      ],
      verdict: "right_better",
      reason: "The candidate is better supported.",
      evidence: "Compared immutable snapshots.",
      evaluatorModel: { provider: "faux", id: "judge-1" },
      createdAt: "2026-07-25T08:00:00.000Z",
    });
    await expect(
      store.saveRunEvaluation({
        ...structuredClone(evaluation),
        id: "evaluation_invalid_evidence",
        leftSnapshotSha256: "invalid",
      }),
    ).rejects.toThrow("Persisted Run evaluation is invalid");
    const first = await store.reviewRunEvaluation(thread.id, evaluation.id, {
      expectedVerdict: "tie",
      note: "Initial review found equivalent outcomes.",
    });
    const noOp = await store.reviewRunEvaluation(thread.id, evaluation.id, {
      expectedVerdict: "tie",
      note: "Initial review found equivalent outcomes.",
    });
    expect(noOp).toEqual(first);
    const revised = await store.reviewRunEvaluation(thread.id, evaluation.id, {
      expectedVerdict: "right_better",
      note: "Second review confirmed the candidate.",
    });
    expect(revised).toEqual(
      expect.objectContaining({
        id: first.id,
        currentRevision: 2,
        revisions: [
          expect.objectContaining({ revision: 1, expectedVerdict: "tie" }),
          expect.objectContaining({
            revision: 2,
            expectedVerdict: "right_better",
          }),
        ],
      }),
    );
    expect((await store.getDetail(thread.id)).evaluationAdjudications).toEqual([
      revised,
    ]);
    expect(store.getEvaluationCalibration(thread.id)).toEqual(
      expect.objectContaining({
        sampleCount: 1,
        agreementCount: 1,
        agreementRate: 1,
      }),
    );
    const casebook = await store.createEvaluationCasebook({
      threadId: thread.id,
      name: "Release gold set",
      description: "Reviewed evidence for evaluator calibration.",
    });
    const curated = await store.curateEvaluationCasebookCase(casebook.id, {
      threadId: thread.id,
      evaluationId: evaluation.id,
    });
    expect(curated).toEqual(
      expect.objectContaining({
        id: casebook.id,
        currentRevision: 2,
        revisions: [
          expect.objectContaining({ source: "created" }),
          expect.objectContaining({
            source: "case_curated",
            sourceEvaluationId: evaluation.id,
            caseIds: [expect.stringMatching(/^evalcase_/)],
          }),
        ],
        cases: [expect.objectContaining({ evaluation })],
      }),
    );
    expect(
      await store.curateEvaluationCasebookCase(casebook.id, {
        threadId: thread.id,
        evaluationId: evaluation.id,
      }),
    ).toEqual(curated);
    expect(store.getEvaluationCasebookCalibration(casebook.id)).toEqual(
      expect.objectContaining({
        casebookId: casebook.id,
        casebookRevision: 2,
        sampleCount: 1,
        agreementRate: 1,
      }),
    );
    expect(store.exportEvaluationCasebook(casebook.id)).toEqual(
      expect.objectContaining({
        kind: "napier.evaluation-casebook",
        casebook: curated,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );

    for (let index = 0; index < 52; index += 1) {
      await store.saveRunEvaluation({
        ...structuredClone(evaluation),
        id: `evaluation_retention_${String(index).padStart(8, "0")}`,
        createdAt: new Date(
          Date.parse("2026-07-25T09:00:00.000Z") + index,
        ).toISOString(),
      });
    }
    expect(store.listRunEvaluations(thread.id)).toHaveLength(50);
    expect(
      store
        .listRunEvaluations(thread.id)
        .some((candidate) => candidate.id === evaluation.id),
    ).toBe(true);

    store.close();
    const reopened = new LocalStore(options);
    await reopened.initialize();
    expect(reopened.listEvaluationAdjudications(thread.id)).toEqual([revised]);
    expect(reopened.getEvaluationCalibration(thread.id).agreementRate).toBe(1);
    expect(reopened.listEvaluationCasebooks()).toEqual([curated]);
    reopened.close();
  });

  it("assigns strictly increasing sequence numbers", async () => {
    const store = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Sequence test",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const events = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        store.appendEvent({
          threadId: thread.id,
          runId: run.id,
          type: "test.event",
          category: "system",
          payload: { index },
        }),
      ),
    );
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("deduplicates proposals and persists review transitions", async () => {
    const store = await createStore();
    const first = await store.proposeMemory(
      {
        content: "The repository requires strict TypeScript.",
        category: "constraint",
      },
      { type: "manual" },
    );
    const duplicate = await store.proposeMemory(
      {
        content: "  The repository requires strict TypeScript. ",
        category: "constraint",
      },
      { type: "manual" },
    );
    expect(duplicate.id).toBe(first.id);
    expect(store.listMemories()).toHaveLength(1);

    const active = await store.reviewMemory(first.id, { action: "approve" });
    expect(active.status).toBe("active");
    expect(active.revision).toBe(2);
    expect(store.listMemories()[0]?.status).toBe("active");
  });

  it("recovers approved memory after a store restart", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-store-"));
    temporaryRoots.push(root);
    const options = {
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    };
    const firstStore = new LocalStore(options);
    await firstStore.initialize();
    const proposal = await firstStore.proposeMemory(
      {
        content: "Persist reviewed memory across restarts.",
        category: "decision",
      },
      { type: "manual" },
    );
    await firstStore.reviewMemory(proposal.id, { action: "approve" });

    const reopened = new LocalStore(options);
    await reopened.initialize();
    expect(reopened.listMemories()).toEqual([
      expect.objectContaining({
        id: proposal.id,
        status: "active",
        content: "Persist reviewed memory across restarts.",
      }),
    ]);
  });

  it("atomically approves corrections and rejects ambiguous replacements", async () => {
    const store = await createStore();
    const agent = store.listAgents()[0]!;
    const originalProposal = await store.proposeMemory(
      {
        content: "Deployments happen on Monday.",
        category: "context",
        scope: "agent",
        agentId: agent.id,
      },
      { type: "manual" },
    );
    const original = await store.reviewMemory(originalProposal.id, {
      action: "approve",
    });

    await expect(
      store.proposeMemory(
        {
          content: original.content,
          category: "correction",
          scope: "agent",
          agentId: agent.id,
          supersedesMemoryId: original.id,
        },
        { type: "manual" },
      ),
    ).rejects.toThrow("Memory correction must change content");
    await expect(
      store.proposeMemory(
        {
          content: "Deployments happen on Tuesday.",
          category: "correction",
          scope: "workspace",
          supersedesMemoryId: original.id,
        },
        { type: "manual" },
      ),
    ).rejects.toThrow("Memory correction must preserve scope and Agent");

    const correction = await store.proposeMemory(
      {
        content: "Deployments happen on Tuesday.",
        category: "correction",
        scope: "agent",
        agentId: agent.id,
        reviewIntervalDays: 30,
        supersedesMemoryId: original.id,
      },
      { type: "manual" },
    );
    await expect(
      store.proposeMemory(
        {
          content: "Deployments happen on Wednesday.",
          category: "correction",
          scope: "agent",
          agentId: agent.id,
          supersedesMemoryId: original.id,
        },
        { type: "manual" },
      ),
    ).rejects.toThrow("Memory already has a pending replacement");

    const replacement = await store.reviewMemory(correction.id, {
      action: "approve",
    });
    const memories = store.listMemories();
    expect(replacement).toEqual(
      expect.objectContaining({
        status: "active",
        supersedesMemoryId: original.id,
        reviewIntervalDays: 30,
      }),
    );
    expect(memories.find((memory) => memory.id === original.id)).toEqual(
      expect.objectContaining({
        status: "archived",
        supersededByMemoryId: replacement.id,
      }),
    );
    await expect(
      store.reviewMemory(original.id, { action: "restore" }),
    ).rejects.toThrow("Cannot restore a superseded memory");
  });

  it("atomically consolidates multiple reviewed facts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-store-"));
    temporaryRoots.push(root);
    const options = {
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    };
    const store = new LocalStore(options);
    await store.initialize();
    const firstProposal = await store.proposeMemory(
      {
        content: "Deployments happen on Tuesday.",
        category: "context",
      },
      { type: "manual" },
    );
    const secondProposal = await store.proposeMemory(
      {
        content: "Deployments require a passed release review.",
        category: "constraint",
      },
      { type: "manual" },
    );
    const first = await store.reviewMemory(firstProposal.id, {
      action: "approve",
    });
    const secondActive = await store.reviewMemory(secondProposal.id, {
      action: "approve",
    });
    const second = await store.reviewMemory(secondActive.id, {
      action: "mark_stale",
    });

    const consolidation = await store.proposeMemory(
      {
        content:
          "Deployments happen on Tuesday after the release review passes.",
        category: "context",
        reviewIntervalDays: 30,
        consolidatesMemoryIds: [second.id, first.id],
      },
      { type: "manual" },
    );
    expect(consolidation.consolidatesMemoryIds).toEqual(
      [first.id, second.id].sort(),
    );
    await expect(
      store.proposeMemory(
        {
          content: "A competing merged fact.",
          consolidatesMemoryIds: [first.id, second.id],
        },
        { type: "manual" },
      ),
    ).rejects.toThrow("Memory already has a pending replacement");

    const replacement = await store.reviewMemory(consolidation.id, {
      action: "approve",
    });
    for (const source of [first, second]) {
      expect(
        store.listMemories().find((memory) => memory.id === source.id),
      ).toEqual(
        expect.objectContaining({
          status: "archived",
          supersededByMemoryId: replacement.id,
        }),
      );
      await expect(
        store.reviewMemory(source.id, { action: "restore" }),
      ).rejects.toThrow("Cannot restore a superseded memory");
    }
    expect(replacement).toEqual(
      expect.objectContaining({
        status: "active",
        reviewIntervalDays: 30,
        consolidatesMemoryIds: [first.id, second.id].sort(),
      }),
    );

    store.close();
    const reopened = new LocalStore(options);
    await reopened.initialize();
    expect(
      reopened
        .listMemories()
        .filter((memory) => memory.supersededByMemoryId === replacement.id),
    ).toHaveLength(2);
    reopened.close();
  });

  it("rejects consolidation across memory scopes", async () => {
    const store = await createStore();
    const agent = store.listAgents()[0]!;
    const workspaceProposal = await store.proposeMemory(
      { content: "Workspace fact." },
      { type: "manual" },
    );
    const agentProposal = await store.proposeMemory(
      {
        content: "Agent fact.",
        scope: "agent",
        agentId: agent.id,
      },
      { type: "manual" },
    );
    const workspaceFact = await store.reviewMemory(workspaceProposal.id, {
      action: "approve",
    });
    const agentFact = await store.reviewMemory(agentProposal.id, {
      action: "approve",
    });

    await expect(
      store.proposeMemory(
        {
          content: "Invalid cross-scope synthesis.",
          scope: "workspace",
          consolidatesMemoryIds: [workspaceFact.id, agentFact.id],
        },
        { type: "manual" },
      ),
    ).rejects.toThrow("Memory consolidation must preserve scope and Agent");
    expect(
      store.listMemories().filter((memory) => memory.status === "active"),
    ).toHaveLength(2);
  });

  it("expires due memory and deduplicates usage within a run", async () => {
    const store = await createStore();
    const proposal = await store.proposeMemory(
      {
        content: "Review this fact every day.",
        category: "constraint",
        reviewIntervalDays: 1,
      },
      { type: "manual" },
    );
    const active = await store.reviewMemory(proposal.id, {
      action: "approve",
    });

    await store.recordMemoryUsage(
      [active.id, active.id],
      "run_memory_usage_1",
      "2026-02-01T00:00:00.000Z",
    );
    expect(
      await store.recordMemoryUsage(
        [active.id],
        "run_memory_usage_1",
        "2026-02-01T00:01:00.000Z",
      ),
    ).toEqual([]);
    expect(store.listMemories()[0]).toEqual(
      expect.objectContaining({
        useCount: 1,
        lastUsedRunId: "run_memory_usage_1",
        lastUsedAt: "2026-02-01T00:00:00.000Z",
      }),
    );

    const expired = await store.expireDueMemories({
      now: new Date(Date.parse(active.reviewDueAt!) + 1),
    });
    expect(expired).toEqual([
      expect.objectContaining({ id: active.id, status: "stale" }),
    ]);
    const refreshed = await store.reviewMemory(active.id, {
      action: "refresh",
    });
    expect(refreshed.status).toBe("active");
    expect(Date.parse(refreshed.reviewDueAt!)).toBeGreaterThan(
      Date.parse(refreshed.reviewedAt!),
    );
  });

  it("persists subagent progress and preserves the first terminal outcome", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-store-"));
    temporaryRoots.push(root);
    const options = {
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    };
    const store = new LocalStore(options);
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Persistent delegation",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const pending = await store.createSubagentTask({
      threadId: thread.id,
      runId: run.id,
      role: "reviewer",
      description: "Review the runtime",
      prompt: "Inspect the runtime for state transition bugs.",
      model: { provider: "faux", id: "faux-1" },
    });
    await store.startSubagentTask(pending.id);
    await store.recordSubagentProgress(pending.id, {
      stepDelta: 2,
      turnDelta: 1,
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      },
    });
    const completed = await store.finishSubagentTask(pending.id, {
      status: "completed",
      stopReason: "completed",
      result: "No state transition bugs found.",
    });
    const duplicateFinish = await store.finishSubagentTask(pending.id, {
      status: "failed",
      stopReason: "error",
      error: "Late failure",
    });

    expect(duplicateFinish).toEqual(completed);
    expect(completed).toEqual(
      expect.objectContaining({
        status: "completed",
        stopReason: "completed",
        stepCount: 2,
        turnCount: 1,
        revision: 4,
      }),
    );

    const reopened = new LocalStore(options);
    await reopened.initialize();
    expect(reopened.listSubagentTasks(thread.id)).toEqual([completed]);
    expect((await reopened.getDetail(thread.id)).subagents).toEqual([
      completed,
    ]);
  });

  it("queues, delivers, cancels, and settles durable Run control messages", async () => {
    const store = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Durable control inbox",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "faux-control", id: "faux-1" },
    });

    const steering = await store.queueRunControlMessage({
      threadId: thread.id,
      runId: run.id,
      mode: "steering",
      text: "Inspect the narrower runtime boundary.",
    });
    const followUp = await store.queueRunControlMessage({
      threadId: thread.id,
      runId: run.id,
      mode: "follow_up",
      text: "Summarize only verified evidence.",
    });
    const settleWithRun = await store.queueRunControlMessage({
      threadId: thread.id,
      runId: run.id,
      mode: "follow_up",
      text: "This queued work should settle with the Run.",
    });

    expect(JSON.stringify([steering, followUp])).not.toContain(
      "narrower runtime",
    );
    expect(store.getThread(thread.id).lastMessage).toBe("");
    const delivered = await store.deliverNextRunControlMessage(
      thread.id,
      run.id,
      "steering",
    );
    expect(delivered).toEqual(
      expect.objectContaining({
        text: "Inspect the narrower runtime boundary.",
        message: expect.objectContaining({
          id: steering.id,
          status: "delivered",
          deliveredEventSeq: expect.any(Number),
          messageEventSeq: expect.any(Number),
        }),
      }),
    );
    expect(store.getThread(thread.id).lastMessage).toBe(
      "Inspect the narrower runtime boundary.",
    );
    expect(delivered?.events.map((event) => event.type)).toEqual([
      "run.control.delivered",
      "message.user",
    ]);
    const cancelled = await store.cancelRunControlMessage(
      thread.id,
      run.id,
      followUp.id,
    );
    expect(cancelled).toEqual(
      expect.objectContaining({
        status: "cancelled",
        cancellationReason: "operator_cancelled",
      }),
    );

    await store.finishRun(run.id, "completed");
    const messages = await store.listRunControlMessages(thread.id, run.id);
    expect(messages).toEqual([
      expect.objectContaining({ id: steering.id, status: "delivered" }),
      expect.objectContaining({ id: followUp.id, status: "cancelled" }),
      expect.objectContaining({
        id: settleWithRun.id,
        status: "cancelled",
        cancellationReason: "run_completed_before_delivery",
      }),
    ]);
    expect((await store.getDetail(thread.id)).runControlMessages).toEqual(
      messages,
    );
    expect(
      (await store.listEvents(thread.id)).filter(
        (event) =>
          event.type === "message.user" &&
          event.payload &&
          !Array.isArray(event.payload) &&
          typeof event.payload === "object" &&
          event.payload["controlMessageId"] === steering.id,
      ),
    ).toHaveLength(1);
  });

  it("enforces pending and total Run control message bounds", async () => {
    const store = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Bounded control inbox",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "faux-control", id: "faux-1" },
    });
    const firstBatch = [];
    for (let index = 0; index < 16; index += 1) {
      firstBatch.push(
        await store.queueRunControlMessage({
          threadId: thread.id,
          runId: run.id,
          mode: "steering",
          text: `Bounded control message ${index}.`,
        }),
      );
    }
    await expect(
      store.queueRunControlMessage({
        threadId: thread.id,
        runId: run.id,
        mode: "steering",
        text: "This message exceeds the pending limit.",
      }),
    ).rejects.toThrow("pending limit reached (16)");

    for (const message of firstBatch) {
      await store.cancelRunControlMessage(thread.id, run.id, message.id);
    }
    for (let index = 16; index < 64; index += 1) {
      const message = await store.queueRunControlMessage({
        threadId: thread.id,
        runId: run.id,
        mode: "follow_up",
        text: `Bounded control message ${index}.`,
      });
      await store.cancelRunControlMessage(thread.id, run.id, message.id);
    }
    await expect(
      store.queueRunControlMessage({
        threadId: thread.id,
        runId: run.id,
        mode: "follow_up",
        text: "This message exceeds the total limit.",
      }),
    ).rejects.toThrow("total limit reached (64)");
  });

  it("reconciles orphan runs and subagents exactly once after restart", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-store-"));
    temporaryRoots.push(root);
    const options = {
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    };
    const store = new LocalStore(options);
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Interrupted work",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "faux-control", id: "faux-1" },
    });
    const plan = await store.createPlan(thread.id, {
      objective: "Recover the interrupted work safely.",
      steps: [
        {
          id: "inspect-state",
          title: "Inspect state",
          description: "Inspect durable state after restart.",
          verification: "The unknown outcome is explicitly resolved.",
        },
      ],
    });
    await store.transitionPlanStep(plan.id, "inspect-state", {
      action: "start",
      runId: run.id,
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "message.user",
      category: "message",
      visibility: "user",
      payload: { role: "user", text: "Perform a recoverable task." },
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "tool.started",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call-interrupted",
        toolName: "external_write",
        status: "started",
      },
    });
    const task = await store.createSubagentTask({
      threadId: thread.id,
      runId: run.id,
      role: "reviewer",
      description: "Review interrupted work",
      prompt: "Inspect the unfinished operation.",
      model: { provider: "faux", id: "faux-1" },
    });
    await store.startSubagentTask(task.id);
    const queuedControl = await store.queueRunControlMessage({
      threadId: thread.id,
      runId: run.id,
      mode: "steering",
      text: "Verify current state before continuing.",
    });

    const reopened = new LocalStore(options);
    await reopened.initialize();
    const detail = await reopened.getDetail(thread.id);
    expect(detail.thread.status).toBe("waiting");
    expect(detail.thread).not.toHaveProperty("currentRunId");
    expect(detail.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: run.id,
          status: "interrupted",
          interruptionReason: expect.stringContaining(
            "before this run reached a terminal state",
          ),
        }),
      ]),
    );
    expect(detail.subagents).toEqual([
      expect.objectContaining({
        id: task.id,
        status: "cancelled",
        stopReason: "cancelled",
        error: "Parent run was interrupted by a runtime restart.",
      }),
    ]);
    expect(detail.runControlMessages).toEqual([
      expect.objectContaining({
        id: queuedControl.id,
        status: "cancelled",
        cancellationReason: "run_interrupted_before_delivery",
      }),
    ]);
    expect(detail.plans).toEqual([
      expect.objectContaining({
        id: plan.id,
        status: "blocked",
        steps: [
          expect.objectContaining({
            id: "inspect-state",
            status: "blocked",
            blocker: expect.stringContaining(
              "before this run reached a terminal state",
            ),
            evidence: expect.stringContaining("unknown"),
          }),
        ],
      }),
    ]);
    expect(
      detail.events.filter((event) => event.type === "run.interrupted"),
    ).toHaveLength(1);
    expect(
      detail.events.filter((event) => event.type === "subagent.cancelled"),
    ).toHaveLength(1);
    expect(
      detail.events.filter((event) => event.type === "plan.step.blocked"),
    ).toHaveLength(1);

    const reopenedAgain = new LocalStore(options);
    await reopenedAgain.initialize();
    const events = await reopenedAgain.listEvents(thread.id);
    expect(
      events.filter((event) => event.type === "run.interrupted"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "subagent.cancelled"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "plan.step.blocked"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "run.control.cancelled"),
    ).toHaveLength(1);
  });
});
