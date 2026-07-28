import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { LocalStore } from "../src/store.js";
import { ModelRegistry } from "../src/models.js";
import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";
import {
  parseBlueprintOutcomeReviewResponse,
  reviewExecutionPlanBlueprintRecordOutcomes,
} from "../src/blueprint-outcome-review.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createStore(): Promise<LocalStore> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-outcome-review-"));
  temporaryRoots.push(root);
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  });
  await store.initialize();
  return store;
}

describe("blueprint outcome model review", () => {
  it("scores completed replay outcomes without leaking delivery prose", async () => {
    const store = await createStore();
    const agent = store.listAgents()[0]!;
    const sourceThread = await store.createThread({
      title: "Outcome review source",
      agentId: agent.id,
    });
    const sourcePlan = await store.createPlan(sourceThread.id, {
      objective: "Create a reusable release review workflow.",
      steps: [
        {
          id: "prepare",
          title: "Prepare",
          description: "Prepare the delivery.",
          verification: "Preparation evidence is recorded.",
        },
        {
          id: "verify",
          title: "Verify",
          description: "Verify the delivery.",
          verification: "Verification evidence is recorded.",
          dependsOn: ["prepare"],
        },
      ],
      artifacts: [
        {
          id: "release-note",
          path: "private/release-note.md",
          description: "Sensitive release note path.",
        },
      ],
    });
    await store.appendEvent({
      threadId: sourceThread.id,
      runId: "runctl_source",
      type: "plan.created",
      category: "plan",
      visibility: "user",
      payload: {
        planId: sourcePlan.id,
        stepCount: sourcePlan.steps.length,
        artifactCount: sourcePlan.artifacts.length,
      },
    });
    const blueprint = await createExecutionPlanBlueprint(
      store,
      sourceThread.id,
      sourcePlan.id,
    );
    const saved = await store.saveExecutionPlanBlueprint(sourceThread.id, {
      blueprint,
      description: "Reusable release review fixture.",
    });
    const targetThread = await store.createThread({
      title: "Outcome review target",
      agentId: agent.id,
    });
    const preview = await store.previewPlanFromBlueprintRecord(
      targetThread.id,
      {
        recordId: saved.record.id,
      },
    );
    const { plan } = await store.createPlanFromBlueprintRecord(
      targetThread.id,
      {
        recordId: saved.record.id,
        expectedPreviewSha256: preview.previewSha256,
      },
    );
    const run = await store.createRun({
      threadId: targetThread.id,
      agentId: agent.id,
    });
    await store.transitionPlanStep(plan.id, "prepare", {
      action: "start",
      runId: run.id,
    });
    await store.transitionPlanStep(plan.id, "prepare", {
      action: "complete",
      evidence: "Sensitive preparation evidence.",
    });
    await store.transitionPlanStep(plan.id, "verify", {
      action: "start",
      runId: run.id,
    });
    await store.transitionPlanStep(plan.id, "verify", {
      action: "complete",
      evidence: "Sensitive verification evidence.",
    });
    await store.updatePlanArtifact(plan.id, "release-note", {
      status: "produced",
      sourceRunId: run.id,
      evidence: "Sensitive artifact production evidence.",
    });
    await store.updatePlanArtifact(plan.id, "release-note", {
      status: "verified",
      sha256: "a".repeat(64),
      sourceRunId: run.id,
      evidence: "Sensitive artifact verification evidence.",
    });
    const outcomes = await store.getExecutionPlanBlueprintRecordReplayOutcomes(
      saved.record.id,
    );
    const unreviewedBaseline =
      await store.promoteExecutionPlanBlueprintRecordOutcomeBaseline(
        saved.record.id,
        { outcomes },
      );

    const provider = fauxProvider({ provider: "faux-outcome-review" });
    provider.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          verdict: "promote",
          score: 94,
          risk: "low",
          reason:
            "The replay completed with verified projection hashes and no blocked or invalid outcomes.",
          concerns: ["Continue collecting replay volume before broad rollout."],
          scores: [
            {
              criterionId: "completion",
              score: 100,
              reason: "All observed replays completed.",
            },
            {
              criterionId: "stability",
              score: 80,
              reason: "Replay count is still small.",
            },
            {
              criterionId: "auditability",
              score: 100,
              reason: "Outcome and baseline hashes are present.",
            },
            {
              criterionId: "reuse_risk",
              score: 95,
              reason: "No blocked or invalid outcomes are present.",
            },
          ],
        }),
      ),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);

    const review = await reviewExecutionPlanBlueprintRecordOutcomes(
      store,
      models,
      saved.record.id,
      {
        model: { provider: "faux-outcome-review", id: "faux-1" },
      },
    );

    expect(review).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-outcome-review",
        schemaVersion: 1,
        policyId: "napier.blueprint-outcome-review.v1",
        recordId: saved.record.id,
        blueprintSha256: saved.record.blueprintSha256,
        model: { provider: "faux-outcome-review", id: "faux-1" },
        verdict: "promote",
        score: 94,
        risk: "low",
        sourceQualificationStatus: "qualified",
        outcomeQualificationStatus: "qualified",
        replayOutcomesSha256: outcomes.contentSha256,
        replayHistorySha256: outcomes.replayHistorySha256,
        outcomeSetSha256: outcomes.outcomeSetSha256,
        replayCount: 1,
        completedCount: 1,
        blockedCount: 0,
        invalidCount: 0,
        completionRateBps: 10_000,
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
        reviewSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(review.scores.map((score) => score.criterionId)).toEqual([
      "completion",
      "stability",
      "auditability",
      "reuse_risk",
    ]);
    const serialized = JSON.stringify(review);
    expect(serialized).not.toContain(
      "Create a reusable release review workflow",
    );
    expect(serialized).not.toContain("private/release-note.md");
    expect(serialized).not.toContain("Sensitive preparation evidence");
    expect(JSON.stringify(review.modelContextEnvelope)).not.toContain(
      "Create a reusable release review workflow",
    );
    expect(JSON.stringify(review.modelContextEnvelope)).not.toContain(
      "private/release-note.md",
    );
    expect(review.reviewSha256).not.toBe(review.responseSha256);
    const reviewedBaseline =
      await store.promoteExecutionPlanBlueprintRecordOutcomeBaseline(
        saved.record.id,
        {
          outcomes,
          review,
        },
      );
    expect(reviewedBaseline).toEqual({
      created: true,
      baseline: expect.objectContaining({
        recordId: saved.record.id,
        replayOutcomesSha256: outcomes.contentSha256,
        reviewGate: {
          minScore: 80,
          maxRisk: "medium",
        },
        reviewSha256: review.reviewSha256,
        reviewInputSha256: review.inputSha256,
        reviewResponseSha256: review.responseSha256,
        reviewVerdict: "promote",
        reviewScore: 94,
        reviewRisk: "low",
        reviewModel: { provider: "faux-outcome-review", id: "faux-1" },
        supersedesBaselineId: unreviewedBaseline.baseline.id,
      }),
    });
    await expect(
      store.promoteExecutionPlanBlueprintRecordOutcomeBaseline(
        saved.record.id,
        {
          outcomes,
          review: { ...review, score: 20 },
        },
      ),
    ).rejects.toThrow("Execution plan blueprint outcome review hash mismatch");
    const envelope = review.modelContextEnvelope;
    expect(envelope).toBeDefined();
    if (!envelope) throw new Error("Expected blueprint review envelope");
    await expect(
      store.promoteExecutionPlanBlueprintRecordOutcomeBaseline(
        saved.record.id,
        {
          outcomes,
          review: {
            ...review,
            modelContextEnvelope: {
              ...envelope,
              contentSha256: "b".repeat(64),
            },
          },
        },
      ),
    ).rejects.toThrow("Model context envelope hash mismatch");
  });

  it("fails closed for demo or malformed reviewer output", async () => {
    const store = await createStore();
    const agent = store.listAgents()[0]!;
    const sourceThread = await store.createThread({
      title: "Outcome review demo",
      agentId: agent.id,
    });
    const sourcePlan = await store.createPlan(sourceThread.id, {
      objective: "Review demo outcome.",
      steps: [
        {
          id: "demo",
          title: "Demo",
          description: "Demo step.",
          verification: "Demo verification.",
        },
      ],
    });
    await store.appendEvent({
      threadId: sourceThread.id,
      runId: "runctl_demo",
      type: "plan.created",
      category: "plan",
      visibility: "user",
      payload: {
        planId: sourcePlan.id,
        stepCount: sourcePlan.steps.length,
        artifactCount: sourcePlan.artifacts.length,
      },
    });
    const blueprint = await createExecutionPlanBlueprint(
      store,
      sourceThread.id,
      sourcePlan.id,
    );
    const saved = await store.saveExecutionPlanBlueprint(sourceThread.id, {
      blueprint,
      description: "Demo outcome review fixture.",
    });
    const targetThread = await store.createThread({
      title: "Outcome review demo target",
      agentId: agent.id,
    });
    const preview = await store.previewPlanFromBlueprintRecord(
      targetThread.id,
      {
        recordId: saved.record.id,
      },
    );
    await store.createPlanFromBlueprintRecord(targetThread.id, {
      recordId: saved.record.id,
      expectedPreviewSha256: preview.previewSha256,
    });

    const demoReview = await reviewExecutionPlanBlueprintRecordOutcomes(
      store,
      new ModelRegistry(),
      saved.record.id,
      {
        model: { provider: "napier", id: "demo" },
      },
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
    expect(demoReview.reviewSha256).toMatch(/^[a-f0-9]{64}$/);

    const provider = fauxProvider({ provider: "faux-outcome-review-failure" });
    provider.setResponses([fauxAssistantMessage("not json")]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const malformedReview = await reviewExecutionPlanBlueprintRecordOutcomes(
      store,
      models,
      saved.record.id,
      {
        model: { provider: "faux-outcome-review-failure", id: "faux-1" },
      },
    );
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

    const outcomes = await store.getExecutionPlanBlueprintRecordReplayOutcomes(
      saved.record.id,
    );
    await expect(
      store.promoteExecutionPlanBlueprintRecordOutcomeBaseline(
        saved.record.id,
        {
          outcomes,
          policy: { minCompletionRateBps: 0 },
          review: demoReview,
          reviewGate: { minScore: 0 },
        },
      ),
    ).rejects.toThrow(
      "Execution plan blueprint outcome baseline review failed: review_not_promote",
    );
    expect(() => parseBlueprintOutcomeReviewResponse("not json")).toThrow(
      "did not contain JSON",
    );
  });
});
