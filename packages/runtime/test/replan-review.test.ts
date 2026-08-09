import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { ModelRegistry } from "../src/models.js";
import {
  reviewExecutionPlanReplanDraft,
  parseReplanDraftReviewResponse,
} from "../src/replan-review.js";
import {
  createExecutionPlan,
  interruptPlanRun,
  transitionPlanStep,
} from "../src/plans.js";

function blockedPlan() {
  const created = createExecutionPlan("thread-replan-review", {
    objective: "Recover a blocked release plan.",
    steps: [
      {
        id: "inspect",
        title: "Inspect",
        description: "Inspect the current state.",
        verification: "Inspection evidence is recorded.",
      },
      {
        id: "implement",
        title: "Implement",
        description: "Implement the release path.",
        verification: "The implementation builds.",
        dependsOn: ["inspect"],
      },
      {
        id: "verify",
        title: "Verify",
        description: "Verify the release path.",
        verification: "All checks pass.",
        dependsOn: ["implement"],
      },
    ],
  });
  const inspected = transitionPlanStep(
    transitionPlanStep(created, "inspect", {
      action: "start",
      runId: "run-inspect",
    }),
    "inspect",
    {
      action: "complete",
      evidence: "Inspection completed.",
    },
  );
  return interruptPlanRun(
    transitionPlanStep(inspected, "implement", {
      action: "start",
      runId: "run-implement",
    }),
    "run-implement",
  );
}

describe("replan draft model review", () => {
  it("binds model-scored draft reviews to prompt, input, response, and recommendation hashes", async () => {
    const plan = blockedPlan();
    const provider = fauxProvider({ provider: "faux-replan-review" });
    provider.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          verdict: "approve",
          score: 91,
          risk: "low",
          reason:
            "The draft replaces the blocked step and preserves downstream verification.",
          concerns: [
            "Confirm the replacement implementation keeps the audit artifact current.",
          ],
        }),
      ),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);

    const review = await reviewExecutionPlanReplanDraft(models, plan, {
      provider: "faux-replan-review",
      id: "faux-1",
    });

    expect(review).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-replan-draft-review",
        schemaVersion: 1,
        policyId: "napier.replan-draft-model-review.v1",
        planId: plan.id,
        threadId: plan.threadId,
        expectedRevision: plan.replanRecommendation!.expectedRevision,
        recommendationSha256: plan.replanRecommendation!.recommendationSha256,
        draftSha256: plan.replanRecommendation!.draft.draftSha256,
        deterministicEvaluationSha256:
          plan.replanRecommendation!.draft.evaluation.evaluationSha256,
        model: { provider: "faux-replan-review", id: "faux-1" },
        verdict: "approve",
        score: 91,
        risk: "low",
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        promptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        responseSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        reviewSchemaSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        modelContextEnvelope: expect.objectContaining({
          kind: "napier.model-context-envelope",
          schemaVersion: 2,
          turnIndex: 0,
          messageCount: 1,
          toolCount: 0,
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        reviewSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(review.modelContextEnvelope)).not.toContain(
      plan.objective,
    );
    expect(JSON.stringify(review.modelContextEnvelope)).not.toContain(
      plan.replanRecommendation?.reason,
    );
    expect(review.reviewSha256).not.toBe(review.responseSha256);
  });

  it("fails closed for demo or malformed reviewer output", async () => {
    const plan = blockedPlan();
    const demoReview = await reviewExecutionPlanReplanDraft(
      new ModelRegistry(),
      plan,
      { provider: "napier", id: "demo" },
    );
    expect(demoReview).toEqual(
      expect.objectContaining({
        verdict: "inconclusive",
        score: 0,
        risk: "high",
        concerns: ["live_model_required"],
      }),
    );
    expect(demoReview).not.toHaveProperty("modelContextEnvelope");

    const provider = fauxProvider({ provider: "faux-replan-review-failure" });
    provider.setResponses([fauxAssistantMessage("not json")]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const malformedReview = await reviewExecutionPlanReplanDraft(models, plan, {
      provider: "faux-replan-review-failure",
      id: "faux-1",
    });
    expect(malformedReview).toEqual(
      expect.objectContaining({
        verdict: "inconclusive",
        score: 0,
        risk: "high",
        concerns: ["review_failed_closed"],
        modelContextEnvelope: expect.objectContaining({
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(JSON.stringify(malformedReview)).not.toContain("not json");
    expect(() => parseReplanDraftReviewResponse("not json")).toThrow(
      "did not contain JSON",
    );
  });
});
