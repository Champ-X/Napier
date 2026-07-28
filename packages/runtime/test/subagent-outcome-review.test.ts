import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { emptyUsage, type SubagentTask } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { ModelRegistry } from "../src/models.js";
import {
  buildSubagentOutcomeReviewPrompt,
  parseSubagentOutcomeReviewResponse,
  reviewSubagentOutcome,
} from "../src/subagent-outcome-review.js";
import { createSubagentOutcome } from "../src/subagent-outcomes.js";

const RESULT_TEXT = JSON.stringify({
  summary: "The API boundary is explicit and covered.",
  items: [
    {
      kind: "finding",
      severity: "info",
      title: "Explicit boundary",
      detail: "The public method validates the stored receipt.",
      evidence: [],
    },
  ],
  unknowns: ["External provider behavior was not exercised."],
});

function createTask(): SubagentTask {
  const task = {
    id: "task_reviewfixture",
    threadId: "thread_reviewfixture",
    runId: "run_reviewfixture",
    role: "reviewer" as const,
    description: "Review the public API boundary.",
    prompt: "Inspect the public API boundary and identify unsupported claims.",
    status: "completed" as const,
    result: "The API boundary is explicit and covered.",
    model: { provider: "worker", id: "worker-1" },
    stepCount: 1,
    turnCount: 1,
    usage: emptyUsage(),
    createdAt: "2026-07-28T00:00:00.000Z",
    startedAt: "2026-07-28T00:00:01.000Z",
    finishedAt: "2026-07-28T00:00:02.000Z",
    revision: 3,
  };
  return {
    ...task,
    outcome: createSubagentOutcome({
      taskId: task.id,
      role: task.role,
      model: task.model,
      prompt: task.prompt,
      resultText: RESULT_TEXT,
    }),
  };
}

describe("Subagent outcome review", () => {
  it("uses an independent zero-tool model and emits a hash-bound review", async () => {
    const task = createTask();
    const faux = fauxProvider({ provider: "faux-subagent-review" });
    faux.setResponses([
      (context) => {
        expect(context.tools).toEqual([]);
        expect(context.systemPrompt).toContain("independent passive reviewer");
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain(task.prompt);
        expect(messages).toContain(task.outcome?.contentSha256);
        return fauxAssistantMessage(
          JSON.stringify({
            verdict: "accept",
            score: 92,
            risk: "low",
            reason: "The outcome is scoped, explicit, and honest.",
            concerns: ["minor_follow_up"],
          }),
        );
      },
    ]);
    const registry = new ModelRegistry();
    registry.registerProvider(faux.provider);

    const review = await reviewSubagentOutcome(registry, task, {
      provider: faux.provider.id,
      id: "faux-1",
    });

    expect(review).toEqual(
      expect.objectContaining({
        kind: "napier.subagent-outcome-review",
        schemaVersion: 1,
        policyId: "napier.subagent-outcome-review.v1",
        taskId: task.id,
        role: task.role,
        outcomeSha256: task.outcome?.contentSha256,
        workerModel: task.model,
        reviewerModel: { provider: faux.provider.id, id: "faux-1" },
        verdict: "accept",
        score: 92,
        risk: "low",
        reason: "The outcome is scoped, explicit, and honest.",
        concerns: ["minor_follow_up"],
        criteria: [
          "task_alignment",
          "evidence_grounding",
          "uncertainty_honesty",
          "actionability",
        ],
        itemCount: 1,
        unknownCount: 1,
        evidenceCount: 0,
        usage: expect.objectContaining({
          inputTokens: expect.any(Number),
          outputTokens: expect.any(Number),
        }),
        criteriaSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        promptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        responseSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        reviewSchemaSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        modelContextEnvelope: expect.objectContaining({
          kind: "napier.model-context-envelope",
          schemaVersion: 1,
          turnIndex: 0,
          messageCount: 1,
          toolCount: 0,
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        createdAt: expect.any(String),
        reviewSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(review.modelContextEnvelope)).not.toContain(
      task.prompt,
    );
    expect(JSON.stringify(review.modelContextEnvelope)).not.toContain(
      task.outcome?.summary,
    );
    expect(faux.state.callCount).toBe(1);
  });

  it("fails reviewer errors closed without throwing or reusing the worker", async () => {
    const task = createTask();
    const faux = fauxProvider({ provider: "faux-subagent-review-invalid" });
    faux.setResponses([fauxAssistantMessage("Not JSON.")]);
    const registry = new ModelRegistry();
    registry.registerProvider(faux.provider);

    const review = await reviewSubagentOutcome(registry, task, {
      provider: faux.provider.id,
      id: "faux-1",
    });
    expect(review).toEqual(
      expect.objectContaining({
        verdict: "inconclusive",
        score: 0,
        risk: "high",
        reason: "The independent Subagent outcome reviewer failed closed.",
        concerns: ["review_failed_closed"],
        responseSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        modelContextEnvelope: expect.objectContaining({
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(JSON.stringify(review)).not.toContain("Not JSON.");

    await expect(
      reviewSubagentOutcome(new ModelRegistry(), task, task.model),
    ).rejects.toThrow("must differ from the worker model");
  });

  it("returns an explicit inconclusive receipt for the demo reviewer", async () => {
    const review = await reviewSubagentOutcome(
      new ModelRegistry(),
      createTask(),
      { provider: "napier", id: "demo" },
    );

    expect(review).toEqual(
      expect.objectContaining({
        reviewerModel: { provider: "napier", id: "demo" },
        verdict: "inconclusive",
        risk: "high",
        concerns: ["live_model_required"],
        usage: emptyUsage(),
      }),
    );
    expect(review).not.toHaveProperty("modelContextEnvelope");
  });

  it("strictly parses one exact review object and rejects wrappers", () => {
    expect(
      parseSubagentOutcomeReviewResponse(
        JSON.stringify({
          verdict: "revise",
          score: 60,
          risk: "medium",
          reason: "Clarify the unsupported assumption.",
          concerns: ["unsupported_assumption", "missing_context"],
        }),
      ),
    ).toEqual({
      verdict: "revise",
      score: 60,
      risk: "medium",
      reason: "Clarify the unsupported assumption.",
      concerns: ["missing_context", "unsupported_assumption"],
    });
    expect(() =>
      parseSubagentOutcomeReviewResponse(
        '```json\n{"verdict":"accept","score":100,"risk":"low","reason":"ok","concerns":[]}\n```',
      ),
    ).toThrow("one valid JSON object");
    expect(() =>
      parseSubagentOutcomeReviewResponse(
        '{"verdict":"accept","score":100,"risk":"low","reason":"ok","concerns":[],"extra":true}',
      ),
    ).toThrow("unsupported field");
    expect(() =>
      parseSubagentOutcomeReviewResponse(
        JSON.stringify({
          verdict: "accept",
          score: 100,
          risk: "low",
          reason: "x".repeat(1_001),
          concerns: [],
        }),
      ),
    ).toThrow("reason is invalid");
  });

  it("builds a deterministic prompt bound to the task and receipt", () => {
    const task = createTask();
    if (!task.outcome) throw new Error("Outcome fixture is missing");
    const first = buildSubagentOutcomeReviewPrompt(task);
    const second = buildSubagentOutcomeReviewPrompt(task);

    expect(first).toEqual(second);
    expect(first).toEqual(
      expect.objectContaining({
        system: expect.stringContaining("cannot call tools"),
        user: expect.stringContaining(task.outcome.contentSha256),
        criteriaSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        promptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        reviewSchemaSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });
});
