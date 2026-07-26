import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { RunRecord } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_EVALUATION_SUITE_GATE,
  EvaluationSuiteService,
  createEvaluationSuiteGateReceipt,
  hashEvaluationSuiteGateReceipt,
  hashEvaluationSuiteExecution,
  validateEvaluationSuiteGateReceipt,
} from "../src/evaluation-suites.js";
import { DEFAULT_EVALUATION_RUBRIC } from "../src/evaluation.js";
import { createId } from "../src/ids.js";
import { ModelRegistry } from "../src/models.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { LocalStore } from "../src/store.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
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
  const root = await mkdtemp(path.join(tmpdir(), "napier-eval-suite-"));
  temporaryRoots.push(root);
  const options = {
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  };
  const store = new LocalStore(options);
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

function evaluationResponse(
  verdict: "left_better" | "right_better" | "tie",
  leftScore: number,
  rightScore: number,
): string {
  return JSON.stringify({
    verdict,
    reason: "Compared immutable run evidence.",
    evidence: "The candidate evidence was inspected.",
    scores: DEFAULT_EVALUATION_RUBRIC.criteria.map((criterion) => ({
      criterionId: criterion.id,
      leftScore,
      rightScore,
      reason: `Scored ${criterion.name}.`,
    })),
  });
}

describe("durable evaluation suites", () => {
  it("executes a hash-bound batch and applies the quality gate", async () => {
    const { store, options } = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Evaluation suite",
      agentId: agent.id,
    });
    const baseline = await createTerminalRun(
      store,
      thread.id,
      agent.id,
      "Baseline result.",
    );
    const passing = await createTerminalRun(
      store,
      thread.id,
      agent.id,
      "Candidate result with stronger evidence.",
    );
    const lowScoreTie = await createTerminalRun(
      store,
      thread.id,
      agent.id,
      "Candidate result with weak evidence.",
    );
    const provider = fauxProvider({ provider: "faux-evaluator" });
    provider.setResponses([
      fauxAssistantMessage(evaluationResponse("right_better", 3, 4)),
      fauxAssistantMessage(evaluationResponse("tie", 2, 2)),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);

    const suite = await store.createEvaluationSuite(thread.id, {
      name: "Release quality gate",
      baselineRunId: baseline.id,
      candidateRunIds: [passing.id, lowScoreTie.id],
      model: { provider: "faux-evaluator", id: "faux-1" },
      gate: {
        minimumPassRate: 0.5,
        minimumCandidateScore: 3,
        allowInconclusive: false,
      },
    });
    const unchanged = await store.updateEvaluationSuite(suite.id, {
      name: suite.name,
    });
    expect(unchanged.revision).toBe(1);

    const service = new EvaluationSuiteService(store, models);
    const execution = await service.execute(thread.id, suite.id);
    expect(execution).toEqual(
      expect.objectContaining({
        suiteId: suite.id,
        suiteRevision: 1,
        passedCount: 1,
        failedCount: 1,
        inconclusiveCount: 0,
        passRate: 0.5,
        averageCandidateScore: 3,
        status: "passed",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(execution.results.map((result) => result.status)).toEqual([
      "passed",
      "failed",
    ]);
    for (const result of execution.results) {
      expect(result.evaluationSha256).toMatch(/^[a-f0-9]{64}$/);
    }
    const {
      id: _id,
      contentSha256: _contentSha256,
      startedAt: _startedAt,
      finishedAt: _finishedAt,
      ...hashInput
    } = execution;
    expect(hashEvaluationSuiteExecution(hashInput)).toBe(
      execution.contentSha256,
    );
    expect(
      (await store.listEvents(thread.id)).map((event) => event.type),
    ).toEqual(
      expect.arrayContaining([
        "evaluation.completed",
        "evaluation.suite.completed",
      ]),
    );
    const bundle = await exportThreadReplayBundle(store, thread.id);
    expect(bundle.evaluationSuites).toEqual([suite]);
    expect(bundle.evaluationSuiteExecutions).toEqual([execution]);
    const imported = await store.importThreadReplayBundle(bundle);
    expect(imported.evaluationSuites).toEqual([
      expect.objectContaining({
        id: expect.not.stringMatching(suite.id),
        baselineRunId: expect.not.stringMatching(baseline.id),
      }),
    ]);
    expect(imported.evaluationSuiteExecutions).toEqual([
      expect.objectContaining({
        id: expect.not.stringMatching(execution.id),
        suiteId: imported.evaluationSuites[0]!.id,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);

    await expect(
      store.saveEvaluationSuiteExecution({
        ...execution,
        id: createId("evalsuite"),
        contentSha256: "0".repeat(64),
      }),
    ).rejects.toThrow("content hash mismatch");

    store.close();
    const reopened = new LocalStore(options);
    await reopened.initialize();
    expect(reopened.listEvaluationSuites(thread.id)).toEqual([suite]);
    expect(reopened.listEvaluationSuiteExecutions(thread.id)).toEqual([
      execution,
    ]);
    reopened.close();
  });

  it("exports a current-revision gate receipt with self-contained evidence", async () => {
    const { store } = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Evaluation gate receipt",
      agentId: agent.id,
    });
    const baseline = await createTerminalRun(
      store,
      thread.id,
      agent.id,
      "Baseline.",
    );
    const candidate = await createTerminalRun(
      store,
      thread.id,
      agent.id,
      "Candidate.",
    );
    const provider = fauxProvider({ provider: "faux-receipt" });
    provider.setResponses([
      fauxAssistantMessage(evaluationResponse("right_better", 3, 4)),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const suite = await store.createEvaluationSuite(thread.id, {
      name: "Receipt gate",
      baselineRunId: baseline.id,
      candidateRunIds: [candidate.id],
      model: { provider: "faux-receipt", id: "faux-1" },
    });

    const notRun = createEvaluationSuiteGateReceipt(store, thread.id, suite.id);
    expect(notRun).toEqual(
      expect.objectContaining({
        state: "not_run",
        evaluations: [],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(notRun).not.toHaveProperty("execution");
    expect(
      createEvaluationSuiteGateReceipt(store, thread.id, suite.id)
        .contentSha256,
    ).toBe(notRun.contentSha256);
    expect(validateEvaluationSuiteGateReceipt(notRun)).toEqual(notRun);

    const execution = await new EvaluationSuiteService(store, models).execute(
      thread.id,
      suite.id,
    );
    const receipt = createEvaluationSuiteGateReceipt(
      store,
      thread.id,
      suite.id,
    );
    expect(receipt).toEqual(
      expect.objectContaining({
        state: "passed",
        execution,
        evaluations: [
          expect.objectContaining({ id: execution.results[0]!.evaluationId }),
        ],
      }),
    );
    const {
      generatedAt: _generatedAt,
      contentSha256: _contentSha256,
      ...receiptContent
    } = receipt;
    expect(hashEvaluationSuiteGateReceipt(receiptContent)).toBe(
      receipt.contentSha256,
    );
    expect(validateEvaluationSuiteGateReceipt(receipt)).toEqual(receipt);

    const tampered = structuredClone(receipt);
    tampered.evaluations[0]!.scores[0]!.rightScore = 1;
    expect(() => validateEvaluationSuiteGateReceipt(tampered)).toThrow(
      "case evidence is invalid",
    );

    const revised = await store.updateEvaluationSuite(suite.id, {
      gate: { minimumPassRate: 0.5 },
    });
    expect(revised.revision).toBe(2);
    const revisedReceipt = createEvaluationSuiteGateReceipt(
      store,
      thread.id,
      suite.id,
    );
    expect(revisedReceipt.state).toBe("not_run");
    expect(revisedReceipt).not.toHaveProperty("execution");
    expect(revisedReceipt.evaluations).toEqual([]);
    expect(revisedReceipt.contentSha256).not.toBe(receipt.contentSha256);
    store.close();
  });

  it("fails closed when every case is inconclusive", async () => {
    const { store } = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Inconclusive suite",
      agentId: agent.id,
    });
    const baseline = await createTerminalRun(
      store,
      thread.id,
      agent.id,
      "Baseline.",
    );
    const candidate = await createTerminalRun(
      store,
      thread.id,
      agent.id,
      "Candidate.",
    );
    const suite = await store.createEvaluationSuite(thread.id, {
      name: "Demo gate",
      baselineRunId: baseline.id,
      candidateRunIds: [candidate.id],
    });
    expect(suite.gate).toEqual(DEFAULT_EVALUATION_SUITE_GATE);

    const execution = await new EvaluationSuiteService(
      store,
      new ModelRegistry(),
    ).execute(thread.id, suite.id);
    expect(execution).toEqual(
      expect.objectContaining({
        status: "inconclusive",
        passRate: 0,
        passedCount: 0,
        failedCount: 0,
        inconclusiveCount: 1,
      }),
    );
  });

  it("rejects non-terminal, duplicate, and baseline candidate runs", async () => {
    const { store } = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Invalid suite",
      agentId: agent.id,
    });
    const baseline = await createTerminalRun(
      store,
      thread.id,
      agent.id,
      "Baseline.",
    );
    const running = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    await expect(
      store.createEvaluationSuite(thread.id, {
        name: "Running candidate",
        baselineRunId: baseline.id,
        candidateRunIds: [running.id],
      }),
    ).rejects.toThrow(`Evaluation suite run must be terminal: ${running.id}`);
    await expect(
      store.createEvaluationSuite(thread.id, {
        name: "Duplicate baseline",
        baselineRunId: baseline.id,
        candidateRunIds: [baseline.id],
      }),
    ).rejects.toThrow(
      "Evaluation suite requires 1-8 unique candidates distinct from baseline",
    );
  });
});
