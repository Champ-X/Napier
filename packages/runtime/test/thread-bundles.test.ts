import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createSubagentOutcome,
  createSubagentOutcomeRepairOutcome,
  createSubagentOutcomeRepairRequest,
  createThreadReplayBundle,
  exportThreadReplayBundle,
  hashThreadEventStream,
  LEDGER_DATABASE_FILENAME,
  LocalStore,
  validateSubagentOutcomeRepairOutcome,
  validateSubagentOutcomeRepairRequest,
  validateThreadReplayBundle,
  verifyThreadReplayBundle,
} from "../src/index.js";

const temporaryRoots: string[] = [];
const openStores: LocalStore[] = [];

afterEach(async () => {
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createStore(): Promise<{
  store: LocalStore;
  dataRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-thread-bundle-"));
  temporaryRoots.push(root);
  const dataRoot = path.join(root, "data");
  const store = new LocalStore({
    dataRoot,
    workspaceRoot: path.join(root, "workspace"),
  });
  openStores.push(store);
  await store.initialize();
  return { store, dataRoot };
}

describe("thread replay bundles", () => {
  it("binds deterministic content and event hashes while excluding generation time", async () => {
    const { store } = await createStore();
    const thread = store.listThreads()[0]!;
    const detail = await store.getDetail(thread.id);

    const first = createThreadReplayBundle(
      detail,
      new Date("2026-07-25T08:00:00.000Z"),
    );
    const second = createThreadReplayBundle(
      detail,
      new Date("2026-07-25T09:00:00.000Z"),
    );

    expect(first.generatedAt).not.toBe(second.generatedAt);
    expect(first.contentSha256).toBe(second.contentSha256);
    expect(first.eventStreamSha256).toBe(hashThreadEventStream(first.events));
    expect(validateThreadReplayBundle(first)).toEqual(first);
    expect(verifyThreadReplayBundle(first)).toEqual({
      status: "valid",
      diagnostics: [],
      threadId: first.thread.id,
      agentId: first.agent.id,
      contentSha256: first.contentSha256,
      eventStreamSha256: first.eventStreamSha256,
      eventCount: first.events.length,
      runCount: first.runs.length,
      planCount: first.plans.length,
      evaluationCount: first.evaluations.length,
    });

    const tampered = structuredClone(first);
    tampered.events[0]!.payload = { text: "tampered fixture evidence" };
    expect(() => validateThreadReplayBundle(tampered)).toThrow(
      "event stream hash mismatch",
    );
    expect(verifyThreadReplayBundle(tampered)).toEqual({
      status: "invalid",
      diagnostics: ["hash_mismatch"],
      eventCount: 0,
      runCount: 0,
      planCount: 0,
      evaluationCount: 0,
    });

    const extended = structuredClone(first) as unknown as Record<
      string,
      unknown
    >;
    extended["unexpected"] = true;
    expect(() => validateThreadReplayBundle(extended)).toThrow(
      "unsupported field",
    );

    const invalidState = structuredClone(first);
    (invalidState.runs[0] as { status: string }).status = "teleported";
    expect(() => validateThreadReplayBundle(invalidState)).toThrow(
      "runs[0].status is invalid",
    );

    const driftedConfiguration = structuredClone(first);
    driftedConfiguration.runs[0]!.configuration!.thinkingLevel = "high";
    expect(() => validateThreadReplayBundle(driftedConfiguration)).toThrow(
      "Run configuration fingerprint hash mismatch",
    );

    const conflictingConfiguration = structuredClone(first);
    conflictingConfiguration.runs[0]!.agentRevision =
      conflictingConfiguration.runs[0]!.configuration!.agentRevision + 1;
    expect(() => validateThreadReplayBundle(conflictingConfiguration)).toThrow(
      "run configuration conflicts with run",
    );

    const incomplete = structuredClone(first) as unknown as Record<
      string,
      unknown
    >;
    delete incomplete["agent"];
    expect(() => validateThreadReplayBundle(incomplete)).toThrow(
      "missing field: agent",
    );

    const collidingIds = structuredClone(first);
    collidingIds.events[0]!.id = collidingIds.runs[0]!.id;
    expect(() => validateThreadReplayBundle(collidingIds)).toThrow(
      "reuses resource ID across record types",
    );
  });

  it("reconstructs a continued operator decision after Run ID remapping", async () => {
    const { store } = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Portable operator decision",
      agentId: agent.id,
    });
    const originRun = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "faux-decision", id: "faux-1" },
    });
    const requested = await store.requestOperatorDecision({
      threadId: thread.id,
      runId: originRun.id,
      header: "Scope",
      question: "Which portable scope should continue?",
      options: [
        {
          label: "Runtime",
          description: "Continue with runtime evidence only.",
        },
        {
          label: "Product",
          description: "Continue through every product surface.",
        },
      ],
      multiSelect: false,
    });
    await store.finishRun(originRun.id, "completed", {
      waitForOperatorDecisionId: requested.decision.id,
    });
    await store.answerOperatorDecision(thread.id, requested.decision.id, {
      selectedOptionIds: ["option_2"],
      customText: "Preserve the portable evidence chain.",
    });
    const continuationRun = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "faux-decision", id: "faux-1" },
      parentRunId: originRun.id,
      operatorDecisionId: requested.decision.id,
    });
    const sourceDecision = (
      await store.continueOperatorDecision(
        thread.id,
        requested.decision.id,
        continuationRun.id,
      )
    ).decision;
    await store.finishRun(continuationRun.id, "completed");

    const invalidDetail = structuredClone(await store.getDetail(thread.id));
    const invalidContinuedEvent = invalidDetail.events.find(
      (event) => event.type === "operator.decision.continued",
    )!;
    invalidContinuedEvent.payload = {
      ...invalidContinuedEvent.payload,
      continuationRunId: "run_phantom1234",
    };
    expect(() => createThreadReplayBundle(invalidDetail)).toThrow(
      "Operator Decision continuation binding is invalid",
    );

    const bundle = await exportThreadReplayBundle(store, thread.id);
    const imported = await store.importThreadReplayBundle(bundle);
    const importedContinuation = imported.runs.find(
      (run) => run.parentRunId !== undefined,
    )!;
    const importedOrigin = imported.runs.find(
      (run) => run.id === importedContinuation.parentRunId,
    )!;
    const importedDecision = imported.operatorDecisions[0]!;

    expect(importedOrigin.id).not.toBe(originRun.id);
    expect(importedContinuation.id).not.toBe(continuationRun.id);
    expect(importedContinuation.parentRunId).toBe(importedOrigin.id);
    expect(importedDecision).toEqual(
      expect.objectContaining({
        id: sourceDecision.id,
        threadId: imported.thread.id,
        runId: importedOrigin.id,
        status: "continued",
        continuationRunId: importedContinuation.id,
        questionSha256: sourceDecision.questionSha256,
        answerSha256: sourceDecision.answerSha256,
        selectedOptionIds: ["option_2"],
        customText: "Preserve the portable evidence chain.",
      }),
    );
    expect(importedDecision.contentSha256).not.toBe(
      sourceDecision.contentSha256,
    );
    expect(
      imported.events.find(
        (event) => event.type === "operator.decision.continued",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        continuationRunId: importedContinuation.id,
      }),
    );
  });

  it("atomically imports every thread-owned record with remapped IDs and closed in-flight state", async () => {
    const { store } = await createStore();
    const originalAgent = store.listAgents()[0]!;
    const agent = await store.updateAgent(originalAgent.id, {
      name: "Portable Incident Agent",
      systemPrompt:
        "Preserve incident evidence and verify state before side effects.",
      toolPolicy: "workspace",
    });
    const thread = await store.createThread({
      title: "Portable incident investigation",
      agentId: agent.id,
    });
    const left = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: left.id,
      type: "message.user",
      category: "message",
      payload: { role: "user", text: "Inspect the first trace." },
    });
    await store.finishRun(left.id, "completed");
    const right = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: right.id,
      type: "message.assistant",
      category: "message",
      payload: { role: "assistant", text: "The second trace is complete." },
    });
    const completedTask = await store.createSubagentTask({
      threadId: thread.id,
      runId: right.id,
      role: "reviewer",
      description: "Review the completed evidence.",
      prompt: "Check the completed trace against the ledger.",
      model: { provider: "napier", id: "demo" },
    });
    await store.startSubagentTask(completedTask.id);
    const completedResultText = JSON.stringify({
      summary: "The completed trace is ledger-backed.",
      items: [],
      unknowns: [],
    });
    const completedOutcome = createSubagentOutcome({
      taskId: completedTask.id,
      role: completedTask.role,
      model: completedTask.model,
      prompt: completedTask.prompt,
      resultText: completedResultText,
    });
    const repairRequest = createSubagentOutcomeRepairRequest({
      taskId: completedTask.id,
      role: completedTask.role,
      model: completedTask.model,
      taskPrompt: completedTask.prompt,
      predecessorResult: "Malformed source candidate.",
      diagnostic: "Subagent result must be one valid JSON object",
      attempt: 1,
      maxAttempts: 1,
    });
    const repairOutcome = createSubagentOutcomeRepairOutcome({
      request: repairRequest.payload,
      status: "accepted",
      resultText: completedResultText,
      outcomeSha256: completedOutcome.contentSha256,
    });
    await store.recordSubagentProgress(completedTask.id, {
      turnDelta: 2,
      stepDelta: 2,
    });
    const completedTaskRecord = await store.finishSubagentTask(
      completedTask.id,
      {
        status: "completed",
        stopReason: "completed",
        result: completedOutcome.summary,
        outcome: completedOutcome,
      },
    );
    await store.appendEvent({
      threadId: thread.id,
      runId: right.id,
      type: "subagent.step",
      category: "subagent",
      payload: {
        taskId: completedTask.id,
        kind: "assistant",
        contentRedacted: true,
        textSha256: repairRequest.payload.predecessorResultSha256,
        textBytes: repairRequest.payload.predecessorResultBytes,
      },
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: right.id,
      type: "subagent.outcome.repair.requested",
      category: "subagent",
      payload: repairRequest.payload,
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: right.id,
      type: "subagent.step",
      category: "subagent",
      payload: {
        taskId: completedTask.id,
        kind: "outcome_repair",
        contentRedacted: true,
        textSha256: completedOutcome.resultSha256,
        textBytes: Buffer.byteLength(completedResultText, "utf8"),
        toolCallCount: 0,
      },
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: right.id,
      type: "subagent.outcome.repair.outcome",
      category: "subagent",
      payload: repairOutcome,
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: right.id,
      type: "subagent.outcome.accepted",
      category: "subagent",
      payload: {
        taskId: completedTask.id,
        role: completedTask.role,
        status: "accepted",
        outcomeSha256: completedOutcome.contentSha256,
        resultSha256: completedOutcome.resultSha256,
        itemSetSha256: completedOutcome.itemSetSha256,
        itemCount: completedOutcome.itemCount,
        unknownCount: completedOutcome.unknownCount,
      },
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: right.id,
      type: "subagent.completed",
      category: "subagent",
      payload: {
        taskId: completedTask.id,
        role: completedTask.role,
        status: "completed",
        outcome: completedTaskRecord.outcome!,
      },
    });
    await store.finishRun(right.id, "completed");
    const evaluation = await store.saveRunEvaluation({
      id: "evaluation_fixture_source",
      threadId: thread.id,
      leftRunId: left.id,
      rightRunId: right.id,
      leftSnapshotSha256: "a".repeat(64),
      rightSnapshotSha256: "b".repeat(64),
      rubric: {
        name: "Fixture rubric",
        criteria: [
          {
            id: "correctness",
            name: "Correctness",
            description: "Grounded in ledger evidence.",
          },
        ],
      },
      scores: [
        {
          criterionId: "correctness",
          leftScore: 3,
          rightScore: 4,
          reason: "The second run records stronger evidence.",
        },
      ],
      verdict: "right_better",
      reason: "The second run is better supported.",
      evidence: "Both snapshots are hash-bound.",
      evaluatorModel: { provider: "napier", id: "demo" },
      createdAt: "2026-07-25T08:15:00.000Z",
    });
    const initialAdjudication = await store.reviewRunEvaluation(
      thread.id,
      evaluation.id,
      {
        expectedVerdict: "tie",
        note: "The first human review found equivalent evidence.",
      },
    );
    const manualAdjudication = await store.reviewRunEvaluation(
      thread.id,
      evaluation.id,
      {
        expectedVerdict: "right_better",
        note: "A second review confirmed the stronger evidence.",
      },
    );
    expect(manualAdjudication.currentRevision).toBe(2);
    expect(manualAdjudication.id).toBe(initialAdjudication.id);
    const reviewerA = await store.submitEvaluationReviewerBallot(
      thread.id,
      evaluation.id,
      {
        reviewerId: "fixture_owner",
        reviewerName: "Fixture Owner",
        expectedVerdict: "right_better",
        note: "The candidate preserves stronger fixture evidence.",
      },
    );
    const reviewerB = await store.submitEvaluationReviewerBallot(
      thread.id,
      evaluation.id,
      {
        reviewerId: "quality_owner",
        reviewerName: "Quality Owner",
        expectedVerdict: "right_better",
        note: "The snapshot evidence supports the candidate.",
      },
    );
    const consensus = await store.resolveEvaluationConsensus(
      thread.id,
      evaluation.id,
      {},
    );
    const adjudication = consensus.adjudication;
    expect(adjudication.currentRevision).toBe(3);
    const active = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      source: "schedule",
      triggerId: "fixture:active-run",
    });
    const plan = await store.createPlan(thread.id, {
      objective: "Verify the imported state before continuing.",
      steps: [
        {
          id: "verify",
          title: "Verify current state",
          description: "Inspect durable evidence.",
          verification: "Record a fresh verification event.",
        },
      ],
    });
    await store.transitionPlanStep(plan.id, "verify", {
      action: "start",
      runId: active.id,
    });
    const task = await store.createSubagentTask({
      threadId: thread.id,
      runId: active.id,
      role: "reviewer",
      description: "Review the active evidence.",
      prompt: "Check every claim against the ledger.",
      model: { provider: "napier", id: "demo" },
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: active.id,
      type: "fixture.references",
      category: "system",
      payload: {
        refs: [
          thread.id,
          agent.id,
          left.id,
          active.id,
          plan.id,
          evaluation.id,
          adjudication.id,
          reviewerA.id,
          consensus.resolution.id,
          task.id,
        ],
      },
    });

    const bundle = await exportThreadReplayBundle(store, thread.id);
    expect(bundle.agentRevisions).toEqual([
      expect.objectContaining({
        revision: 2,
        source: "updated",
        profile: agent,
      }),
      expect.objectContaining({
        revision: 1,
        source: "created",
        profile: originalAgent,
      }),
    ]);
    expect(bundle.evaluationAdjudications).toEqual([adjudication]);
    expect(bundle.evaluationReviewerBallots).toEqual([reviewerA, reviewerB]);
    expect(bundle.evaluationConsensusResolutions).toEqual([
      consensus.resolution,
    ]);
    const tamperedHistory = structuredClone(bundle);
    tamperedHistory.agentRevisions![0]!.profile.systemPrompt =
      "Tampered historical prompt.";
    expect(() => validateThreadReplayBundle(tamperedHistory)).toThrow(
      "Agent profile revision evidence is invalid",
    );
    const tamperedAdjudication = structuredClone(bundle);
    tamperedAdjudication.evaluationAdjudications![0]!.revisions[0]!.note =
      "Tampered human review.";
    expect(() => validateThreadReplayBundle(tamperedAdjudication)).toThrow(
      "revision hash mismatch",
    );
    const tamperedRepairStep = structuredClone(bundle);
    const sourceCandidateStep = tamperedRepairStep.events.find(
      (event) =>
        event.type === "subagent.step" &&
        event.payload &&
        !Array.isArray(event.payload) &&
        typeof event.payload === "object" &&
        event.payload["kind"] === "assistant" &&
        event.payload["contentRedacted"] === true,
    );
    if (
      !sourceCandidateStep?.payload ||
      Array.isArray(sourceCandidateStep.payload) ||
      typeof sourceCandidateStep.payload !== "object"
    ) {
      throw new Error("Repair source candidate step fixture is missing");
    }
    sourceCandidateStep.payload["textSha256"] = "f".repeat(64);
    expect(() => validateThreadReplayBundle(tamperedRepairStep)).toThrow(
      "outcome repair request is invalid",
    );
    const imported = await store.importThreadReplayBundle(
      bundle,
      "Imported verification fixture",
    );

    expect(imported.thread).toEqual(
      expect.objectContaining({
        title: "Imported verification fixture",
        status: "waiting",
        eventCount: bundle.events.length,
        importProvenance: expect.objectContaining({
          sourceThreadId: thread.id,
          sourceContentSha256: bundle.contentSha256,
          sourceEventStreamSha256: bundle.eventStreamSha256,
          sourceEventCount: bundle.events.length,
        }),
      }),
    );
    expect(imported.thread).not.toHaveProperty("currentRunId");
    expect(imported.agent.id).not.toBe(agent.id);
    expect(imported.agent).toEqual(
      expect.objectContaining({
        name: agent.name,
        revision: agent.revision,
      }),
    );
    expect(store.listAgentRevisions(imported.agent.id)).toEqual([
      expect.objectContaining({
        agentId: imported.agent.id,
        revision: 2,
        source: "updated",
        profile: imported.agent,
        contentSha256: expect.not.stringMatching(
          bundle.agentRevisions![0]!.contentSha256,
        ),
      }),
      expect.objectContaining({
        agentId: imported.agent.id,
        revision: 1,
        source: "created",
      }),
    ]);
    expect(imported.runs).toHaveLength(3);
    expect(imported.runs.map((run) => run.id)).not.toContain(active.id);
    expect(imported.runs[0]?.configuration?.contentSha256).toBe(
      bundle.runs[0]?.configuration?.contentSha256,
    );
    const importedActive = imported.runs.find(
      (run) => run.startedAt === active.startedAt,
    )!;
    expect(importedActive).toEqual(
      expect.objectContaining({
        status: "interrupted",
        interruptionReason: expect.stringContaining("Imported fixture"),
      }),
    );
    expect(importedActive).not.toHaveProperty("triggerId");
    expect(importedActive).not.toHaveProperty("lease");
    expect(imported.plans).toEqual([
      expect.objectContaining({
        id: expect.not.stringMatching(plan.id),
        threadId: imported.thread.id,
        status: "blocked",
        steps: [
          expect.objectContaining({
            id: "verify",
            runId: importedActive.id,
            status: "blocked",
            evidence: expect.stringContaining("unknown"),
          }),
        ],
      }),
    ]);
    expect(imported.evaluations).toEqual([
      expect.objectContaining({
        id: expect.not.stringMatching(evaluation.id),
        threadId: imported.thread.id,
        leftRunId: imported.runs[0]!.id,
        rightRunId: imported.runs[1]!.id,
      }),
    ]);
    expect(imported.evaluationAdjudications).toEqual([
      expect.objectContaining({
        id: expect.not.stringMatching(adjudication.id),
        threadId: imported.thread.id,
        evaluationId: imported.evaluations[0]!.id,
        currentRevision: 3,
        revisions: [
          expect.objectContaining({
            revision: 1,
            expectedVerdict: "tie",
            evaluationSha256: expect.not.stringMatching(
              adjudication.revisions[0]!.evaluationSha256,
            ),
            contentSha256: expect.not.stringMatching(
              adjudication.revisions[0]!.contentSha256,
            ),
          }),
          expect.objectContaining({
            revision: 2,
            expectedVerdict: "right_better",
          }),
          expect.objectContaining({
            revision: 3,
            expectedVerdict: "right_better",
            source: "reviewer_consensus",
            sourceSha256:
              imported.evaluationConsensusResolutions[0]!.report.contentSha256,
          }),
        ],
      }),
    ]);
    expect(imported.evaluationReviewerBallots).toEqual([
      expect.objectContaining({
        id: expect.not.stringMatching(reviewerA.id),
        threadId: imported.thread.id,
        evaluationId: imported.evaluations[0]!.id,
        reviewerId: reviewerA.reviewerId,
      }),
      expect.objectContaining({
        id: expect.not.stringMatching(reviewerB.id),
        threadId: imported.thread.id,
        evaluationId: imported.evaluations[0]!.id,
        reviewerId: reviewerB.reviewerId,
      }),
    ]);
    expect(imported.evaluationConsensusResolutions).toEqual([
      expect.objectContaining({
        id: expect.not.stringMatching(consensus.resolution.id),
        threadId: imported.thread.id,
        evaluationId: imported.evaluations[0]!.id,
        adjudicationId: imported.evaluationAdjudications[0]!.id,
        report: expect.objectContaining({
          contentSha256: expect.not.stringMatching(
            consensus.report.contentSha256,
          ),
        }),
      }),
    ]);
    expect(imported.subagents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.not.stringMatching(completedTask.id),
          threadId: imported.thread.id,
          runId: imported.runs[1]!.id,
          status: "completed",
          outcome: expect.objectContaining({
            resultSha256: completedOutcome.resultSha256,
            itemSetSha256: completedOutcome.itemSetSha256,
            contentSha256: expect.not.stringMatching(
              completedOutcome.contentSha256,
            ),
          }),
        }),
        expect.objectContaining({
          id: expect.not.stringMatching(task.id),
          threadId: imported.thread.id,
          runId: importedActive.id,
          status: "cancelled",
          stopReason: "cancelled",
        }),
      ]),
    );
    const importedActiveTask = imported.subagents.find(
      (candidate) => candidate.runId === importedActive.id,
    )!;
    const importedCompletedTask = imported.subagents.find(
      (candidate) => candidate.status === "completed",
    )!;
    const importedOutcomeAccepted = imported.events.find(
      (event) => event.type === "subagent.outcome.accepted",
    )!;
    const importedRepairRequest = validateSubagentOutcomeRepairRequest(
      imported.events.find(
        (event) => event.type === "subagent.outcome.repair.requested",
      )!.payload,
    );
    const importedRepairOutcome = validateSubagentOutcomeRepairOutcome(
      imported.events.find(
        (event) => event.type === "subagent.outcome.repair.outcome",
      )!.payload,
    );
    expect(importedRepairRequest).toEqual(
      expect.objectContaining({
        taskId: importedCompletedTask.id,
        predecessorResultSha256: repairRequest.payload.predecessorResultSha256,
        contentSha256: expect.not.stringMatching(
          repairRequest.payload.contentSha256,
        ),
      }),
    );
    expect(importedRepairOutcome).toEqual(
      expect.objectContaining({
        taskId: importedCompletedTask.id,
        requestContentSha256: importedRepairRequest.contentSha256,
        resultSha256: repairOutcome.resultSha256,
        outcomeSha256: importedCompletedTask.outcome!.contentSha256,
        contentSha256: expect.not.stringMatching(repairOutcome.contentSha256),
      }),
    );
    expect(importedOutcomeAccepted.payload).toEqual(
      expect.objectContaining({
        taskId: importedCompletedTask.id,
        outcomeSha256: importedCompletedTask.outcome!.contentSha256,
        resultSha256: importedCompletedTask.outcome!.resultSha256,
        itemSetSha256: importedCompletedTask.outcome!.itemSetSha256,
      }),
    );
    const importedSubagentCompleted = imported.events.find(
      (event) => event.type === "subagent.completed",
    )!;
    expect(importedSubagentCompleted.payload).toEqual(
      expect.objectContaining({
        taskId: importedCompletedTask.id,
        outcome: importedCompletedTask.outcome,
      }),
    );
    expect(imported.events.map((event) => event.seq)).toEqual(
      bundle.events.map((event) => event.seq),
    );
    const referenceEvent = imported.events.find(
      (event) => event.type === "fixture.references",
    )!;
    expect(referenceEvent.payload).toEqual({
      refs: [
        imported.thread.id,
        imported.agent.id,
        imported.runs[0]!.id,
        importedActive.id,
        imported.plans[0]!.id,
        imported.evaluations[0]!.id,
        imported.evaluationAdjudications[0]!.id,
        imported.evaluationReviewerBallots[0]!.id,
        imported.evaluationConsensusResolutions[0]!.id,
        importedActiveTask.id,
      ],
    });
  });

  it("rolls back the state and the entire event batch when import persistence fails", async () => {
    const { store, dataRoot } = await createStore();
    const sourceThread = store.listThreads()[0]!;
    const bundle = await exportThreadReplayBundle(store, sourceThread.id);
    const originalThreadIds = store.listThreads().map((thread) => thread.id);
    const database = new DatabaseSync(
      path.join(dataRoot, LEDGER_DATABASE_FILENAME),
    );
    const originalEventCount = (
      database.prepare("SELECT COUNT(*) AS count FROM ledger_events").get() as {
        count: number;
      }
    ).count;
    database.exec(`
      CREATE TRIGGER abort_fixture_import
      BEFORE UPDATE ON workspace_state
      BEGIN
        SELECT RAISE(ABORT, 'injected fixture import failure');
      END;
    `);

    await expect(store.importThreadReplayBundle(bundle)).rejects.toThrow(
      "injected fixture import failure",
    );

    expect(store.listThreads().map((thread) => thread.id)).toEqual(
      originalThreadIds,
    );
    expect(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM ledger_events")
          .get() as { count: number }
      ).count,
    ).toBe(originalEventCount);
    database.exec("DROP TRIGGER abort_fixture_import");
    database.close();
  });
});
