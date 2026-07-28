import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type {
  EvaluationCasebook,
  RunEvaluationRecord,
  RunRecord,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  EvaluationCasebookQualificationService,
  createEvaluationCasebookQualificationReceipt,
  hashEvaluationCasebookQualificationExecution,
  validateEvaluationCasebookQualificationExecution,
  validateEvaluationCasebookQualificationReceipt,
} from "../src/evaluation-casebook-qualification.js";
import {
  DEFAULT_EVALUATION_RUBRIC,
  createRunEvaluationGovernanceBinding,
} from "../src/evaluation.js";
import { ModelRegistry } from "../src/models.js";
import {
  createRunReplaySnapshot,
  exportThreadReplayBundle,
} from "../src/replay.js";
import { LocalStore } from "../src/store.js";

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
  options: { dataRoot: string; workspaceRoot: string };
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-casebook-qual-"));
  temporaryRoots.push(root);
  const options = {
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  };
  const store = new LocalStore(options);
  openStores.push(store);
  await store.initialize();
  return { store, options };
}

async function createTerminalRun(
  store: LocalStore,
  threadId: string,
  agentId: string,
  text: string,
): Promise<RunRecord> {
  const run = await store.createRun({ threadId, agentId });
  await store.appendEvent({
    threadId,
    runId: run.id,
    type: "message.assistant",
    category: "message",
    visibility: "user",
    payload: { role: "assistant", text },
  });
  return store.finishRun(run.id, "completed");
}

async function createCuratedFixture(): Promise<{
  store: LocalStore;
  options: { dataRoot: string; workspaceRoot: string };
  threadId: string;
  left: RunRecord;
  right: RunRecord;
  evaluation: RunEvaluationRecord;
  casebook: EvaluationCasebook;
}> {
  const { store, options } = await createStore();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Executable Casebook qualification",
    agentId: agent.id,
  });
  const left = await createTerminalRun(
    store,
    thread.id,
    agent.id,
    "Baseline answer.",
  );
  const right = await createTerminalRun(
    store,
    thread.id,
    agent.id,
    "Candidate answer with verified evidence.",
  );
  const [leftSnapshot, rightSnapshot] = await Promise.all([
    createRunReplaySnapshot(store, thread.id, left.id),
    createRunReplaySnapshot(store, thread.id, right.id),
  ]);
  const comparisonGovernance = createRunEvaluationGovernanceBinding({
    status: "clean",
    left: {
      modelResponseCount: 0,
      envelopeCount: 0,
      boundResponseCount: 0,
      unboundResponseCount: 0,
      coverageRate: 1,
    },
    right: {
      modelResponseCount: 0,
      envelopeCount: 0,
      boundResponseCount: 0,
      unboundResponseCount: 0,
      coverageRate: 1,
    },
    coverageRateDelta: 0,
    diagnostics: [],
  });
  const evaluation = await store.saveRunEvaluation({
    id: "evaluation_casebook_qualification_source",
    threadId: thread.id,
    leftRunId: left.id,
    rightRunId: right.id,
    leftSnapshotSha256: leftSnapshot.eventStreamSha256,
    rightSnapshotSha256: rightSnapshot.eventStreamSha256,
    rubric: structuredClone(DEFAULT_EVALUATION_RUBRIC),
    scores: DEFAULT_EVALUATION_RUBRIC.criteria.map((criterion) => ({
      criterionId: criterion.id,
      leftScore: 3,
      rightScore: 4,
      reason: `${criterion.name} is stronger in the candidate.`,
    })),
    verdict: "right_better",
    reason: "The candidate records stronger evidence.",
    evidence: "Compared immutable replay snapshots.",
    evaluatorModel: { provider: "faux-source", id: "judge-1" },
    comparisonGovernance,
    createdAt: "2026-07-25T10:00:00.000Z",
  });
  await store.reviewRunEvaluation(thread.id, evaluation.id, {
    expectedVerdict: "right_better",
    note: "Human review confirmed the candidate.",
  });
  const created = await store.createEvaluationCasebook({
    threadId: thread.id,
    name: "Release qualification set",
    description: "Frozen reviewed cases for evaluator qualification.",
  });
  const casebook = await store.curateEvaluationCasebookCase(created.id, {
    threadId: thread.id,
    evaluationId: evaluation.id,
  });
  return {
    store,
    options,
    threadId: thread.id,
    left,
    right,
    evaluation,
    casebook,
  };
}

function qualificationResponse(
  verdict: "left_better" | "right_better" | "tie",
): string {
  const leftScore = verdict === "left_better" ? 4 : 3;
  const rightScore = verdict === "right_better" ? 4 : 3;
  return JSON.stringify({
    verdict,
    reason: "Compared the frozen replay evidence.",
    evidence: "The candidate includes a stronger supported answer.",
    scores: DEFAULT_EVALUATION_RUBRIC.criteria.map((criterion) => ({
      criterionId: criterion.id,
      leftScore,
      rightScore,
      reason: `Scored ${criterion.name}.`,
    })),
  });
}

describe("executable Evaluation Casebook qualification", () => {
  it("re-judges frozen evidence without creating ordinary evaluations", async () => {
    const { store, options, threadId, left, right, evaluation, casebook } =
      await createCuratedFixture();
    const notRun = createEvaluationCasebookQualificationReceipt(
      store,
      casebook.id,
    );
    expect(notRun).toEqual(
      expect.objectContaining({
        state: "not_run",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(notRun).not.toHaveProperty("execution");
    expect(validateEvaluationCasebookQualificationReceipt(notRun)).toEqual(
      notRun,
    );

    const provider = fauxProvider({ provider: "faux-qualification" });
    let evaluatorPrompt = "";
    provider.setResponses([
      (context) => {
        evaluatorPrompt = context.messages
          .flatMap((message) =>
            typeof message.content === "string" ? [message.content] : [],
          )
          .join("\n");
        return fauxAssistantMessage(qualificationResponse("right_better"));
      },
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const execution = await new EvaluationCasebookQualificationService(
      store,
      models,
    ).execute(casebook.id, {
      threadId,
      model: { provider: "faux-qualification", id: "faux-1" },
      gate: { minimumAgreementRate: 1 },
    });

    expect(execution).toEqual(
      expect.objectContaining({
        casebookId: casebook.id,
        casebookRevision: casebook.currentRevision,
        sampleCount: 1,
        agreementCount: 1,
        inconclusiveCount: 0,
        unverifiedCount: 0,
        agreementRate: 1,
        status: "passed",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(execution.results).toEqual([
      expect.objectContaining({
        expectedVerdict: "right_better",
        actualVerdict: "right_better",
        evidenceState: "verified",
        status: "agreed",
        expectedLeftSnapshotSha256: evaluation.leftSnapshotSha256,
        observedLeftSnapshotSha256: evaluation.leftSnapshotSha256,
      }),
    ]);
    expect(evaluatorPrompt).toContain("COMPARISON GOVERNANCE:");
    expect(evaluatorPrompt).toContain('"comparisonGovernance"');
    expect(evaluatorPrompt).toContain(
      evaluation.comparisonGovernance!.contentSha256,
    );
    expect(evaluatorPrompt).toContain('"contextCoverageDelta":null');
    expect(store.listRunEvaluations(threadId)).toEqual([evaluation]);
    const qualificationRun = store
      .listRuns(threadId)
      .find((run) => run.id !== left.id && run.id !== right.id);
    expect(qualificationRun).toEqual(
      expect.objectContaining({
        status: "completed",
        configuration: expect.objectContaining({
          model: { provider: "faux-qualification", id: "faux-1" },
        }),
      }),
    );
    const qualificationRunEvents = (await store.listEvents(threadId)).filter(
      (event) => event.runId === qualificationRun!.id,
    );
    expect(qualificationRunEvents.map((event) => event.type)).toEqual([
      "context.model_envelope",
      "model.response",
      "evaluation.casebook.qualification.completed",
    ]);
    const envelopeEvent = qualificationRunEvents.find(
      (event) => event.type === "context.model_envelope",
    );
    const responseEvent = qualificationRunEvents.find(
      (event) => event.type === "model.response",
    );
    if (
      !envelopeEvent?.payload ||
      Array.isArray(envelopeEvent.payload) ||
      typeof envelopeEvent.payload !== "object" ||
      !responseEvent?.payload ||
      Array.isArray(responseEvent.payload) ||
      typeof responseEvent.payload !== "object"
    ) {
      throw new Error("Qualification trace fixture is missing");
    }
    expect(responseEvent.payload).toEqual(
      expect.objectContaining({
        contentRedacted: true,
        model: "faux-qualification/faux-1",
        textSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        textBytes: expect.any(Number),
        modelContextEnvelopeSha256: envelopeEvent.payload["contentSha256"],
        modelContextEnvelopeTurnIndex: 0,
        modelContextMessageSetSha256: envelopeEvent.payload["messageSetSha256"],
        modelContextToolDefinitionSetSha256:
          envelopeEvent.payload["toolDefinitionSetSha256"],
      }),
    );
    expect(responseEvent.payload).not.toHaveProperty("text");
    expect(JSON.stringify(responseEvent.payload)).not.toContain(
      "Compared the frozen replay evidence.",
    );
    const qualificationSnapshot = await createRunReplaySnapshot(
      store,
      threadId,
      qualificationRun!.id,
    );
    expect(qualificationSnapshot.metrics).toEqual(
      expect.objectContaining({
        modelResponseCount: 1,
        modelContextEnvelopeCount: 1,
        embeddedModelContextEnvelopeCount: 0,
        modelContextBoundResponseCount: 1,
        modelContextUnboundResponseCount: 0,
      }),
    );
    const bundle = await exportThreadReplayBundle(store, threadId);
    expect(
      bundle.events
        .filter((event) => event.runId === qualificationRun!.id)
        .map((event) => event.type),
    ).toEqual([
      "context.model_envelope",
      "model.response",
      "evaluation.casebook.qualification.completed",
    ]);
    expect(
      qualificationRunEvents
        .filter(
          (event) =>
            event.type === "evaluation.casebook.qualification.completed",
        )
        .map((event) => event.payload),
    ).toEqual([
      expect.objectContaining({
        executionId: execution.id,
        status: "passed",
        contentSha256: execution.contentSha256,
      }),
    ]);

    const receipt = createEvaluationCasebookQualificationReceipt(
      store,
      casebook.id,
    );
    expect(receipt).toEqual(
      expect.objectContaining({ state: "passed", execution }),
    );
    expect(
      createEvaluationCasebookQualificationReceipt(store, casebook.id)
        .contentSha256,
    ).toBe(receipt.contentSha256);
    expect(validateEvaluationCasebookQualificationReceipt(receipt)).toEqual(
      receipt,
    );

    const tampered = structuredClone(execution);
    tampered.agreementCount = 0;
    expect(() =>
      validateEvaluationCasebookQualificationExecution(tampered, casebook),
    ).toThrow("aggregate is invalid");

    const scoreTampered = structuredClone(execution);
    scoreTampered.results[0]!.scores[0]!.rightScore = 9;
    const {
      id: _tamperedId,
      contentSha256: _tamperedSha256,
      startedAt: _tamperedStartedAt,
      finishedAt: _tamperedFinishedAt,
      ...tamperedContent
    } = scoreTampered;
    scoreTampered.contentSha256 =
      hashEvaluationCasebookQualificationExecution(tamperedContent);
    expect(() =>
      validateEvaluationCasebookQualificationExecution(scoreTampered, casebook),
    ).toThrow("scores are invalid");

    const revised = await store.updateEvaluationCasebook(casebook.id, {
      threadId,
      description: "A new manifest revision invalidates prior receipts.",
    });
    expect(revised.currentRevision).toBe(casebook.currentRevision + 1);
    await expect(
      store.saveEvaluationCasebookQualificationExecution({
        ...structuredClone(execution),
        id: "casequal_stalerevision0001",
      }),
    ).rejects.toThrow("changed during qualification");
    expect(
      createEvaluationCasebookQualificationReceipt(store, casebook.id).state,
    ).toBe("not_run");

    store.close();
    openStores.splice(openStores.indexOf(store), 1);
    const reopened = new LocalStore(options);
    openStores.push(reopened);
    await reopened.initialize();
    expect(
      reopened.listEvaluationCasebookQualificationExecutions(casebook.id),
    ).toEqual([execution]);
    expect(
      createEvaluationCasebookQualificationReceipt(reopened, casebook.id).state,
    ).toBe("not_run");
  });

  it("fails closed for demo judges and drifted replay evidence", async () => {
    const { store, threadId, left, casebook } = await createCuratedFixture();
    const demoExecution = await new EvaluationCasebookQualificationService(
      store,
      new ModelRegistry(),
    ).execute(casebook.id, {
      threadId,
      model: { provider: "napier", id: "demo" },
    });
    expect(demoExecution).toEqual(
      expect.objectContaining({
        status: "inconclusive",
        agreementCount: 0,
        inconclusiveCount: 1,
        unverifiedCount: 0,
      }),
    );
    expect(demoExecution.results).toEqual([
      expect.objectContaining({
        actualVerdict: "inconclusive",
        evidenceState: "verified",
        status: "inconclusive",
      }),
    ]);

    const disagreementProvider = fauxProvider({
      provider: "faux-disagreement",
    });
    disagreementProvider.setResponses([
      fauxAssistantMessage(qualificationResponse("left_better")),
    ]);
    const disagreementModels = new ModelRegistry();
    disagreementModels.registerProvider(disagreementProvider.provider);
    const failed = await new EvaluationCasebookQualificationService(
      store,
      disagreementModels,
    ).execute(casebook.id, {
      threadId,
      model: { provider: "faux-disagreement", id: "faux-1" },
      gate: { minimumAgreementRate: 1 },
    });
    expect(failed).toEqual(
      expect.objectContaining({
        status: "failed",
        agreementCount: 0,
        inconclusiveCount: 0,
        unverifiedCount: 0,
      }),
    );
    expect(failed.results).toEqual([
      expect.objectContaining({
        actualVerdict: "left_better",
        evidenceState: "verified",
        status: "disagreed",
      }),
    ]);

    await store.appendEvent({
      threadId,
      runId: left.id,
      type: "system.note",
      category: "system",
      visibility: "debug",
      payload: { text: "Late evidence must invalidate the frozen hash." },
    });
    let judgeCalled = false;
    const provider = fauxProvider({ provider: "faux-drift-check" });
    provider.setResponses([
      () => {
        judgeCalled = true;
        return fauxAssistantMessage(qualificationResponse("right_better"));
      },
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const drifted = await new EvaluationCasebookQualificationService(
      store,
      models,
    ).execute(casebook.id, {
      threadId,
      model: { provider: "faux-drift-check", id: "faux-1" },
      gate: { allowInconclusive: true, minimumAgreementRate: 0 },
    });
    expect(judgeCalled).toBe(false);
    expect(drifted).toEqual(
      expect.objectContaining({
        status: "inconclusive",
        unverifiedCount: 1,
      }),
    );
    expect(drifted.results).toEqual([
      expect.objectContaining({
        evidenceState: "drifted",
        actualVerdict: "inconclusive",
        status: "inconclusive",
        reason: expect.stringContaining("no longer matches"),
      }),
    ]);
    expect(drifted.results[0]!.observedLeftSnapshotSha256).not.toBe(
      drifted.results[0]!.expectedLeftSnapshotSha256,
    );
  });

  it("retains the latest twenty executions per Casebook across restart", async () => {
    const { store, options, threadId, casebook } = await createCuratedFixture();
    const first = await new EvaluationCasebookQualificationService(
      store,
      new ModelRegistry(),
    ).execute(casebook.id, {
      threadId,
      model: { provider: "napier", id: "demo" },
    });
    const baseTimestamp = Date.parse(first.startedAt);
    for (let index = 0; index < 20; index += 1) {
      const timestamp = new Date(baseTimestamp + index + 1).toISOString();
      const execution = {
        ...structuredClone(first),
        id: `casequal_retention${String(index).padStart(8, "0")}`,
        startedAt: timestamp,
        finishedAt: timestamp,
      };
      const {
        id: _id,
        contentSha256: _contentSha256,
        startedAt: _startedAt,
        finishedAt: _finishedAt,
        ...content
      } = execution;
      execution.contentSha256 =
        hashEvaluationCasebookQualificationExecution(content);
      await store.saveEvaluationCasebookQualificationExecution(execution);
    }
    expect(
      store.listEvaluationCasebookQualificationExecutions(casebook.id),
    ).toHaveLength(20);
    expect(
      store
        .listEvaluationCasebookQualificationExecutions(casebook.id)
        .some((execution) => execution.id === first.id),
    ).toBe(false);

    store.close();
    openStores.splice(openStores.indexOf(store), 1);
    const reopened = new LocalStore(options);
    openStores.push(reopened);
    await reopened.initialize();
    expect(
      reopened.listEvaluationCasebookQualificationExecutions(casebook.id),
    ).toHaveLength(20);
  });
});
