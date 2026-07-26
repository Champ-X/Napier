import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createExecutionPlanArchive,
  verifyExecutionPlanArchive,
} from "../src/plan-archives.js";
import { LocalStore } from "../src/store.js";
import {
  createExecutionPlanBlueprint,
  executionPlanRequestFromBlueprint,
  verifyExecutionPlanBlueprint,
} from "../src/workflow-blueprints.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createStore(): Promise<LocalStore> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-plan-archive-"));
  temporaryRoots.push(root);
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  });
  await store.initialize();
  return store;
}

describe("execution plan archives", () => {
  it("exports and verifies a hash-bound plan workflow archive", async () => {
    const store = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Plan archive",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const plan = await store.createPlan(thread.id, {
      objective: "Ship a portable workflow archive.",
      steps: [
        {
          id: "archive",
          title: "Archive plan",
          description: "Create a stable plan archive.",
          verification: "The archive verifies by hash.",
        },
      ],
      artifacts: [
        {
          id: "archive-json",
          path: "artifacts/plan.json",
          description: "The exported plan archive.",
        },
      ],
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "plan.created",
      category: "plan",
      visibility: "user",
      payload: {
        planId: plan.id,
        stepCount: plan.steps.length,
        artifactCount: plan.artifacts.length,
      },
    });

    const archive = await createExecutionPlanArchive(store, thread.id, plan.id);

    expect(archive).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-archive",
        schemaVersion: 1,
        threadId: thread.id,
        plan: expect.objectContaining({ id: plan.id, revision: 1 }),
        eventStreamSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(archive.events.map((event) => event.type)).toEqual(["plan.created"]);
    expect(verifyExecutionPlanArchive(archive)).toEqual({
      status: "valid",
      diagnostics: [],
      threadId: thread.id,
      planId: plan.id,
      revision: 1,
      contentSha256: archive.contentSha256,
      eventStreamSha256: archive.eventStreamSha256,
      eventCount: 1,
      stepCount: 1,
      artifactCount: 1,
      replanCount: 0,
    });

    const tampered = structuredClone(archive);
    tampered.plan.revision += 1;
    expect(verifyExecutionPlanArchive(tampered)).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: ["hash_mismatch"],
      }),
    );
  });

  it("distills a reusable workflow blueprint from a plan archive", async () => {
    const store = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Plan blueprint",
      agentId: agent.id,
    });
    const plan = await store.createPlan(thread.id, {
      objective: "Reuse a workflow across ledgers.",
      steps: [
        {
          id: "inspect",
          title: "Inspect",
          description: "Inspect the current workspace.",
          verification: "Inspection evidence is recorded.",
        },
        {
          id: "apply",
          title: "Apply",
          description: "Apply the repeatable workflow.",
          verification: "The workflow output is verified.",
          dependsOn: ["inspect"],
        },
      ],
      artifacts: [
        {
          id: "workflow-output",
          path: "artifacts/workflow.md",
          description: "The reusable workflow output.",
        },
      ],
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: "runctl_blueprint",
      type: "plan.created",
      category: "plan",
      visibility: "user",
      payload: {
        planId: plan.id,
        stepCount: plan.steps.length,
        artifactCount: plan.artifacts.length,
      },
    });

    const blueprint = await createExecutionPlanBlueprint(
      store,
      thread.id,
      plan.id,
    );

    expect(blueprint).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint",
        schemaVersion: 1,
        source: expect.objectContaining({
          threadId: thread.id,
          planId: plan.id,
          planArchiveSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        stepCount: 2,
        artifactCount: 1,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(verifyExecutionPlanBlueprint(blueprint)).toEqual({
      status: "valid",
      diagnostics: [],
      contentSha256: blueprint.contentSha256,
      sourceThreadId: thread.id,
      sourcePlanId: plan.id,
      sourcePlanRevision: plan.revision,
      sourcePlanArchiveSha256: blueprint.source.planArchiveSha256,
      sourceEventStreamSha256: blueprint.source.eventStreamSha256,
      stepCount: 2,
      artifactCount: 1,
    });
    expect(executionPlanRequestFromBlueprint(blueprint)).toEqual({
      objective: "Reuse a workflow across ledgers.",
      steps: [
        expect.objectContaining({ id: "inspect" }),
        expect.objectContaining({ id: "apply", dependsOn: ["inspect"] }),
      ],
      artifacts: [
        expect.objectContaining({
          id: "workflow-output",
          path: "artifacts/workflow.md",
        }),
      ],
    });

    const tampered = structuredClone(blueprint);
    tampered.steps[1]!.dependsOn = [];
    expect(verifyExecutionPlanBlueprint(tampered)).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: ["hash_mismatch"],
      }),
    );
  });

  it("stores reusable workflow blueprints and creates plans from records", async () => {
    const store = await createStore();
    const agent = store.listAgents()[0]!;
    const sourceThread = await store.createThread({
      title: "Blueprint library source",
      agentId: agent.id,
    });
    const sourcePlan = await store.createPlan(sourceThread.id, {
      objective: "Create a reusable release workflow.",
      steps: [
        {
          id: "prepare",
          title: "Prepare",
          description: "Prepare the release workflow.",
          verification: "Preparation evidence is recorded.",
        },
        {
          id: "ship",
          title: "Ship",
          description: "Ship the release workflow.",
          verification: "The release workflow is verified.",
          dependsOn: ["prepare"],
        },
      ],
    });
    await store.appendEvent({
      threadId: sourceThread.id,
      runId: "runctl_library",
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

    const first = await store.saveExecutionPlanBlueprint(sourceThread.id, {
      blueprint,
      name: "Release workflow",
      description: "Reusable two-step release workflow.",
    });
    const second = await store.saveExecutionPlanBlueprint(sourceThread.id, {
      blueprint,
      name: "Duplicate release workflow",
    });

    expect(first.created).toBe(true);
    expect(second).toEqual({
      created: false,
      record: first.record,
    });
    expect(store.listExecutionPlanBlueprints("active")).toEqual([first.record]);
    await expect(
      store.qualifyExecutionPlanBlueprintRecord(first.record.id),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "qualified",
        diagnostics: [],
        recordId: first.record.id,
        blueprintSha256: first.record.blueprintSha256,
        expectedPlanArchiveSha256: first.record.sourcePlanArchiveSha256,
        expectedEventStreamSha256: first.record.sourceEventStreamSha256,
        stepCount: blueprint.stepCount,
        artifactCount: blueprint.artifactCount,
        actualPlanArchiveSha256: first.record.sourcePlanArchiveSha256,
        actualEventStreamSha256: first.record.sourceEventStreamSha256,
      }),
    );

    const archived = await store.setExecutionPlanBlueprintRecordStatus(
      first.record.id,
      { status: "archived" },
    );
    expect(archived).toEqual(
      expect.objectContaining({
        id: first.record.id,
        status: "archived",
        archivedAt: expect.any(String),
      }),
    );
    await expect(
      store.qualifyExecutionPlanBlueprintRecord(first.record.id),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "archived",
        diagnostics: ["record_archived"],
        recordId: first.record.id,
      }),
    );
    const restored = await store.setExecutionPlanBlueprintRecordStatus(
      first.record.id,
      { status: "active" },
    );
    expect(restored.status).toBe("active");
    expect(restored.archivedAt).toBeUndefined();
    await expect(
      store.qualifyExecutionPlanBlueprintRecord(first.record.id),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "qualified",
        diagnostics: [],
        recordId: first.record.id,
      }),
    );

    const targetThread = await store.createThread({
      title: "Blueprint library target",
      agentId: agent.id,
    });
    const preview = await store.previewPlanFromBlueprintRecord(
      targetThread.id,
      {
        recordId: first.record.id,
      },
    );
    expect(preview).toEqual(
      expect.objectContaining({
        status: "ready",
        diagnostics: [],
        recordId: first.record.id,
        hasOpenPlan: false,
        previewSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        plan: expect.objectContaining({
          threadId: targetThread.id,
          objective: blueprint.objective,
        }),
      }),
    );
    await expect(
      store.createPlanFromBlueprintRecord(targetThread.id, {
        recordId: first.record.id,
        expectedPreviewSha256: "0".repeat(64),
      }),
    ).rejects.toThrow("Execution plan blueprint preview hash mismatch");
    const {
      plan,
      record,
      qualification,
      event: replayEvent,
      previewSha256,
    } = await store.createPlanFromBlueprintRecord(targetThread.id, {
      recordId: first.record.id,
      expectedPreviewSha256: preview.previewSha256,
    });
    expect(record.id).toBe(first.record.id);
    expect(qualification.status).toBe("qualified");
    expect(plan).toEqual(
      expect.objectContaining({
        threadId: targetThread.id,
        objective: blueprint.objective,
        steps: [
          expect.objectContaining({ id: "prepare", status: "ready" }),
          expect.objectContaining({
            id: "ship",
            dependsOn: ["prepare"],
            status: "pending",
          }),
        ],
      }),
    );
    const qualificationSha256 = createHash("sha256")
      .update(JSON.stringify(qualification))
      .digest("hex");
    const qualificationDiagnosticsSha256 = createHash("sha256")
      .update(JSON.stringify(qualification.diagnostics))
      .digest("hex");
    expect(previewSha256).toBe(preview.previewSha256);
    expect(replayEvent).toEqual(
      expect.objectContaining({
        threadId: targetThread.id,
        type: "plan.created",
        category: "plan",
        visibility: "user",
        seq: 1,
        payload: expect.objectContaining({
          planId: plan.id,
          blueprintRecordId: first.record.id,
          blueprintQualificationSha256: qualificationSha256,
          blueprintQualificationDiagnosticsSha256:
            qualificationDiagnosticsSha256,
          blueprintPreviewSha256: preview.previewSha256,
        }),
      }),
    );
    const replayHistory =
      await store.getExecutionPlanBlueprintRecordReplayHistory(first.record.id);
    expect(replayHistory).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-replay-history",
        schemaVersion: 1,
        recordId: first.record.id,
        replayCount: 1,
        threadCount: 1,
        planCount: 1,
        eventSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        firstSeq: 1,
        lastSeq: 1,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(replayHistory)).not.toContain(plan.objective);
    expect(replayHistory.replays).toEqual([
      expect.objectContaining({
        threadId: targetThread.id,
        planId: plan.id,
        recordId: first.record.id,
        objectiveSha256: createHash("sha256")
          .update(plan.objective)
          .digest("hex"),
        blueprintSha256: first.record.blueprintSha256,
        sourcePlanArchiveSha256: first.record.sourcePlanArchiveSha256,
        qualificationStatus: "qualified",
        qualificationSha256,
        qualificationDiagnosticsSha256,
        previewSha256: preview.previewSha256,
      }),
    ]);
    await expect(
      store.verifyExecutionPlanBlueprintRecordReplayHistory(
        first.record.id,
        replayHistory,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "valid",
        diagnostics: [],
        recordId: first.record.id,
        expectedRecordId: first.record.id,
        declaredContentSha256: replayHistory.contentSha256,
        recomputedContentSha256: replayHistory.contentSha256,
        observedContentSha256: replayHistory.contentSha256,
        declaredEventSetSha256: replayHistory.eventSetSha256,
        observedEventSetSha256: replayHistory.eventSetSha256,
        replayCount: 1,
        observedReplayCount: 1,
      }),
    );
    const replayOutcomes =
      await store.getExecutionPlanBlueprintRecordReplayOutcomes(
        first.record.id,
      );
    expect(replayOutcomes).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-replay-outcomes",
        schemaVersion: 1,
        recordId: first.record.id,
        replayHistorySha256: replayHistory.contentSha256,
        replayCount: 1,
        activeCount: 1,
        completedCount: 0,
        blockedCount: 0,
        cancelledCount: 0,
        invalidCount: 0,
        completionRateBps: 0,
        outcomeSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(replayOutcomes.outcomes).toEqual([
      expect.objectContaining({
        replayEventId: replayEvent.id,
        replayEventSeq: replayEvent.seq,
        threadId: targetThread.id,
        planId: plan.id,
        status: "active",
        planRevision: plan.revision,
        stepCount: 2,
        completedStepCount: 0,
        artifactCount: 0,
        planProjectionSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        outcomeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect(JSON.stringify(replayOutcomes)).not.toContain(plan.objective);
    await expect(
      store.verifyExecutionPlanBlueprintRecordReplayOutcomes(
        first.record.id,
        replayOutcomes,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "valid",
        diagnostics: [],
        recordId: first.record.id,
        expectedRecordId: first.record.id,
        declaredContentSha256: replayOutcomes.contentSha256,
        recomputedContentSha256: replayOutcomes.contentSha256,
        observedContentSha256: replayOutcomes.contentSha256,
        declaredReplayHistorySha256: replayHistory.contentSha256,
        observedReplayHistorySha256: replayHistory.contentSha256,
        declaredOutcomeSetSha256: replayOutcomes.outcomeSetSha256,
        observedOutcomeSetSha256: replayOutcomes.outcomeSetSha256,
        replayCount: 1,
        observedReplayCount: 1,
        completedCount: 0,
        observedCompletedCount: 0,
      }),
    );
    await expect(
      store.verifyExecutionPlanBlueprintRecordReplayOutcomes(first.record.id, {
        ...replayOutcomes,
        completedCount: 1,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: expect.arrayContaining([
          "content_hash_mismatch",
          "completed_count_mismatch",
        ]),
        completedCount: 1,
        observedCompletedCount: 0,
      }),
    );
    await expect(
      store.promoteExecutionPlanBlueprintRecordOutcomeBaseline(
        first.record.id,
        {
          outcomes: replayOutcomes,
        },
      ),
    ).rejects.toThrow(
      "Execution plan blueprint outcome baseline policy failed: completion_rate_below_min",
    );
    const replayEventSha256 = createHash("sha256")
      .update(JSON.stringify(replayEvent))
      .digest("hex");
    await expect(
      store.verifyExecutionPlanBlueprintRecordReplayEvent(first.record.id, {
        threadId: targetThread.id,
        eventId: replayEvent.id,
        seq: replayEvent.seq,
        eventSha256: replayEventSha256,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "valid",
        diagnostics: [],
        expectedRecordId: first.record.id,
        threadId: targetThread.id,
        eventId: replayEvent.id,
        seq: replayEvent.seq,
        declaredEventSha256: replayEventSha256,
        observedEventSha256: replayEventSha256,
        observedReplay: expect.objectContaining({
          eventId: replayEvent.id,
          threadId: targetThread.id,
          recordId: first.record.id,
          planId: plan.id,
          previewSha256: preview.previewSha256,
        }),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    await expect(
      store.verifyExecutionPlanBlueprintRecordReplayEvent(first.record.id, {
        threadId: targetThread.id,
        eventId: replayEvent.id,
        seq: replayEvent.seq,
        eventSha256: "0".repeat(64),
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: ["event_hash_mismatch"],
        declaredEventSha256: "0".repeat(64),
        observedEventSha256: replayEventSha256,
      }),
    );
    await expect(
      store.verifyExecutionPlanBlueprintRecordReplayHistory(first.record.id, {
        ...replayHistory,
        replayCount: 2,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: expect.arrayContaining([
          "content_hash_mismatch",
          "replay_count_mismatch",
        ]),
        replayCount: 2,
        observedReplayCount: 1,
      }),
    );
    await expect(
      store.previewPlanFromBlueprintRecord(targetThread.id, {
        recordId: first.record.id,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "blocked",
        diagnostics: ["thread_has_open_plan"],
        recordId: first.record.id,
        hasOpenPlan: true,
      }),
    );
    const deliveryRun = await store.createRun({
      threadId: targetThread.id,
      agentId: agent.id,
    });
    await store.transitionPlanStep(plan.id, "prepare", {
      action: "start",
      runId: deliveryRun.id,
    });
    await store.transitionPlanStep(plan.id, "prepare", {
      action: "complete",
      evidence: "Preparation contract checks passed.",
    });
    await store.transitionPlanStep(plan.id, "ship", {
      action: "start",
      runId: deliveryRun.id,
    });
    await store.transitionPlanStep(plan.id, "ship", {
      action: "complete",
      evidence: "Delivery evidence was independently verified.",
    });
    const completedOutcomes =
      await store.getExecutionPlanBlueprintRecordReplayOutcomes(
        first.record.id,
      );
    expect(completedOutcomes).toEqual(
      expect.objectContaining({
        replayCount: 1,
        activeCount: 0,
        completedCount: 1,
        blockedCount: 0,
        invalidCount: 0,
        completionRateBps: 10_000,
      }),
    );
    expect(completedOutcomes.outcomes).toEqual([
      expect.objectContaining({
        planId: plan.id,
        status: "completed",
        completedStepCount: 2,
        blockedStepCount: 0,
      }),
    ]);
    expect(JSON.stringify(completedOutcomes)).not.toContain(
      "Delivery evidence was independently verified.",
    );
    await expect(
      store.promoteExecutionPlanBlueprintRecordOutcomeBaseline(
        first.record.id,
        {
          outcomes: replayOutcomes,
          policy: { minCompletionRateBps: 0 },
        },
      ),
    ).rejects.toThrow(
      "Execution plan blueprint outcome baseline requires current outcomes",
    );
    const promotedBaseline =
      await store.promoteExecutionPlanBlueprintRecordOutcomeBaseline(
        first.record.id,
        {
          outcomes: completedOutcomes,
        },
      );
    expect(promotedBaseline).toEqual({
      created: true,
      baseline: expect.objectContaining({
        id: expect.stringMatching(/^outcome_base_[a-f0-9]{20}$/),
        recordId: first.record.id,
        replayOutcomesSha256: completedOutcomes.contentSha256,
        replayHistorySha256: completedOutcomes.replayHistorySha256,
        outcomeSetSha256: completedOutcomes.outcomeSetSha256,
        replayCount: 1,
        completedCount: 1,
        blockedCount: 0,
        invalidCount: 0,
        completionRateBps: 10_000,
        policy: {
          minReplayCount: 1,
          minCompletionRateBps: 10_000,
          maxBlockedCount: 0,
          maxInvalidCount: 0,
        },
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
    expect(
      store.listExecutionPlanBlueprintRecordOutcomeBaselines(first.record.id),
    ).toEqual([promotedBaseline.baseline]);
    await expect(
      store.promoteExecutionPlanBlueprintRecordOutcomeBaseline(
        first.record.id,
        {
          outcomes: completedOutcomes,
        },
      ),
    ).resolves.toEqual({
      created: false,
      baseline: promotedBaseline.baseline,
    });
    await expect(
      store.qualifyExecutionPlanBlueprintRecordOutcomes(first.record.id),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "qualified",
        diagnostics: [],
        recordId: first.record.id,
        baselineId: promotedBaseline.baseline.id,
        baselineSha256: promotedBaseline.baseline.contentSha256,
        baselineOutcomesSha256: completedOutcomes.contentSha256,
        currentOutcomesSha256: completedOutcomes.contentSha256,
        currentReplayHistorySha256: completedOutcomes.replayHistorySha256,
        currentOutcomeSetSha256: completedOutcomes.outcomeSetSha256,
        replayCount: 1,
        completedCount: 1,
        blockedCount: 0,
        invalidCount: 0,
        completionRateBps: 10_000,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    const selectionThread = await store.createThread({
      title: "Blueprint selection target",
      agentId: agent.id,
    });
    const selection = await store.selectExecutionPlanBlueprintRecord(
      selectionThread.id,
      {
        objective: "Reuse the release workflow with fresh delivery evidence.",
        policyTemplate: "delivery_first",
      },
    );
    expect(selection).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-selection",
        schemaVersion: 1,
        threadId: selectionThread.id,
        objectiveSha256: createHash("sha256")
          .update("Reuse the release workflow with fresh delivery evidence.")
          .digest("hex"),
        candidateCount: 1,
        qualifiedCandidateCount: 1,
        rejectedCandidateCount: 0,
        selectedRecordId: first.record.id,
        selectedPreviewSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        selectedBaselineId: promotedBaseline.baseline.id,
        selectedBaselineSha256: promotedBaseline.baseline.contentSha256,
        selectedScoreBps: 10_000,
        selectedFamilySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        selectedFamilyCompletionRateBps: 10_000,
        selectedRecommendationScoreBps: 8_100,
        recommendationPolicy: {
          templateId: "delivery_first",
          weights: {
            outcomeCompletionBps: 7_000,
            familyCompletionBps: 1_000,
            reviewedBaselineBps: 1_000,
            replayEvidenceBps: 1_000,
          },
        },
        recommendationPolicySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        portfolioSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        selectionSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(selection.candidates).toEqual([
      expect.objectContaining({
        recordId: first.record.id,
        selectionStatus: "selected",
        diagnostics: [],
        familySha256: selection.selectedFamilySha256,
        sourceQualificationStatus: "qualified",
        outcomeQualificationStatus: "qualified",
        familyRecordCount: 1,
        familyOutcomeQualifiedCount: 1,
        familyReviewedBaselineCount: 0,
        familyCompletionRateBps: 10_000,
        previewStatus: "ready",
        baselineId: promotedBaseline.baseline.id,
        baselineSha256: promotedBaseline.baseline.contentSha256,
        currentOutcomesSha256: completedOutcomes.contentSha256,
        scoreBps: 10_000,
        recommendationScoreBps: 8_100,
        recommendationPolicyTemplate: "delivery_first",
        recommendationPolicySource: "request",
        replayCount: 1,
        completionRateBps: 10_000,
      }),
    ]);
    expect(JSON.stringify(selection)).not.toContain(
      "Reuse the release workflow with fresh delivery evidence.",
    );
    const policyBacktest =
      await store.backtestExecutionPlanBlueprintRecommendationPolicies();
    expect(policyBacktest).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-recommendation-policy-backtest",
        schemaVersion: 1,
        recordCount: 1,
        activeCount: 1,
        policyCount: 3,
        divergentSelectionCount: 0,
        portfolioSetSha256: selection.portfolioSetSha256,
        policySetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      policyBacktest.results.map(
        (result) => result.recommendationPolicy.templateId,
      ),
    ).toEqual(["balanced", "delivery_first", "portfolio_first"]);
    expect(
      policyBacktest.results.map(
        (result) => result.selectedRecommendationScoreBps,
      ),
    ).toEqual([7_600, 8_100, 7_100]);
    expect(policyBacktest.results[1]).toEqual(
      expect.objectContaining({
        selectedRecordId: first.record.id,
        selectedFamilySha256: selection.selectedFamilySha256,
        averageRecommendationScoreBps: 8_100,
        candidates: [
          expect.objectContaining({
            recordId: first.record.id,
            selectionStatus: "selected",
            diagnostics: [],
            sourceQualificationStatus: "qualified",
            outcomeQualificationStatus: "qualified",
            familyRecordCount: 1,
            familyCompletionRateBps: 10_000,
            familyReviewedBaselineCount: 0,
            reviewedBaselineCoverageBps: 0,
            replayEvidenceBps: 1_000,
            recommendationScoreBps: 8_100,
            replayCount: 1,
            completionRateBps: 10_000,
            currentOutcomesSha256: completedOutcomes.contentSha256,
          }),
        ],
      }),
    );
    expect(JSON.stringify(policyBacktest)).not.toContain(
      "Reuse the release workflow with fresh delivery evidence.",
    );
    const policyOverride =
      await store.setExecutionPlanBlueprintRecommendationPolicyOverride({
        familySha256: selection.selectedFamilySha256!,
        policyTemplate: "portfolio_first",
        expectedPortfolioSetSha256: selection.portfolioSetSha256,
      });
    expect(policyOverride).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-recommendation-policy-override",
        schemaVersion: 1,
        familySha256: selection.selectedFamilySha256,
        recommendationPolicy: {
          templateId: "portfolio_first",
          weights: {
            outcomeCompletionBps: 3_500,
            familyCompletionBps: 3_500,
            reviewedBaselineBps: 2_000,
            replayEvidenceBps: 1_000,
          },
        },
        portfolioSetSha256: selection.portfolioSetSha256,
        familyRecordCount: 1,
        familyOutcomeQualifiedCount: 1,
        familyCompletionRateBps: 10_000,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    await expect(
      store.listExecutionPlanBlueprintRecommendationPolicyOverrides(),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-recommendation-policy-overrides",
        overrideCount: 1,
        portfolioSetSha256: selection.portfolioSetSha256,
        overrideSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        overrides: [policyOverride],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    const policyOverrideDriftReview =
      await store.reviewExecutionPlanBlueprintRecommendationPolicyOverrideDrift();
    expect(policyOverrideDriftReview).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-drift-review",
        schemaVersion: 1,
        overrideCount: 1,
        alignedCount: 0,
        retireRecommendedCount: 1,
        missingFamilyCount: 0,
        portfolioSetSha256: selection.portfolioSetSha256,
        overrideSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        reviewSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        reviews: [
          expect.objectContaining({
            familySha256: selection.selectedFamilySha256,
            overrideSha256: policyOverride.contentSha256,
            status: "retire_recommended",
            recommendation: "retire",
            diagnostics: ["override_policy_not_best"],
            overridePolicyTemplate: "portfolio_first",
            overridePolicySha256: policyOverride.recommendationPolicySha256,
            overrideSelectedRecordId: first.record.id,
            overrideSelectedRecommendationScoreBps: 7_100,
            bestPolicyTemplate: "delivery_first",
            bestPolicySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            bestSelectedRecordId: first.record.id,
            bestSelectedRecommendationScoreBps: 8_100,
            familyRecordCount: 1,
            familyOutcomeQualifiedCount: 1,
            familyCompletionRateBps: 10_000,
            reviewSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        ],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    const overrideSelection = await store.selectExecutionPlanBlueprintRecord(
      selectionThread.id,
    );
    expect(overrideSelection).toEqual(
      expect.objectContaining({
        selectedRecordId: first.record.id,
        selectedRecommendationScoreBps: 7_100,
        selectedRecommendationPolicyTemplate: "portfolio_first",
        selectedRecommendationPolicySha256:
          policyOverride.recommendationPolicySha256,
        selectedRecommendationPolicySource: "family_override",
        selectedFamilyPolicyOverrideSha256: policyOverride.contentSha256,
        familyPolicyOverrideCount: 1,
        familyPolicyOverrideSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(overrideSelection.candidates).toEqual([
      expect.objectContaining({
        recordId: first.record.id,
        selectionStatus: "selected",
        recommendationScoreBps: 7_100,
        recommendationPolicyTemplate: "portfolio_first",
        recommendationPolicySha256: policyOverride.recommendationPolicySha256,
        recommendationPolicySource: "family_override",
        familyPolicyOverrideSha256: policyOverride.contentSha256,
      }),
    ]);
    const policyOverrideRetirement =
      await store.retireExecutionPlanBlueprintRecommendationPolicyOverride({
        familySha256: selection.selectedFamilySha256!,
        expectedOverrideSha256: policyOverride.contentSha256,
        expectedOverrideSetSha256: policyOverrideDriftReview.overrideSetSha256,
        expectedDriftReviewSetSha256: policyOverrideDriftReview.reviewSetSha256,
        expectedPortfolioSetSha256: selection.portfolioSetSha256,
      });
    expect(policyOverrideRetirement).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement",
        schemaVersion: 1,
        familySha256: selection.selectedFamilySha256,
        retiredOverrideSha256: policyOverride.contentSha256,
        retiredRecommendationPolicyTemplate: "portfolio_first",
        retiredRecommendationPolicySha256:
          policyOverride.recommendationPolicySha256,
        portfolioSetSha256: selection.portfolioSetSha256,
        overrideSetSha256: policyOverrideDriftReview.overrideSetSha256,
        driftReviewSetSha256: policyOverrideDriftReview.reviewSetSha256,
        remainingOverrideSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        retiredAt: expect.any(String),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    await expect(
      store.listExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history",
        schemaVersion: 1,
        retirementCount: 1,
        portfolioSetSha256: selection.portfolioSetSha256,
        currentOverrideSetSha256:
          policyOverrideRetirement.remainingOverrideSetSha256,
        retirementSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        latestRetiredAt: policyOverrideRetirement.retiredAt,
        retirements: [policyOverrideRetirement],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    const policyOverrideRetirementHistory =
      await store.listExecutionPlanBlueprintRecommendationPolicyOverrideRetirements();
    await expect(
      store.verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(
        policyOverrideRetirementHistory,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history-verification",
        schemaVersion: 1,
        status: "valid",
        diagnostics: [],
        declaredContentSha256: policyOverrideRetirementHistory.contentSha256,
        recomputedContentSha256: policyOverrideRetirementHistory.contentSha256,
        observedContentSha256: policyOverrideRetirementHistory.contentSha256,
        declaredPortfolioSetSha256:
          policyOverrideRetirementHistory.portfolioSetSha256,
        observedPortfolioSetSha256:
          policyOverrideRetirementHistory.portfolioSetSha256,
        declaredCurrentOverrideSetSha256:
          policyOverrideRetirementHistory.currentOverrideSetSha256,
        observedCurrentOverrideSetSha256:
          policyOverrideRetirementHistory.currentOverrideSetSha256,
        declaredRetirementSetSha256:
          policyOverrideRetirementHistory.retirementSetSha256,
        recomputedRetirementSetSha256:
          policyOverrideRetirementHistory.retirementSetSha256,
        observedRetirementSetSha256:
          policyOverrideRetirementHistory.retirementSetSha256,
        retirementCount: 1,
        observedRetirementCount: 1,
        latestRetiredAt: policyOverrideRetirement.retiredAt,
        observedLatestRetiredAt: policyOverrideRetirement.retiredAt,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    await expect(
      store.verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(
        {
          ...policyOverrideRetirementHistory,
          retirementCount: 2,
        },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: expect.arrayContaining([
          "content_hash_mismatch",
          "retirement_count_mismatch",
        ]),
        declaredContentSha256: policyOverrideRetirementHistory.contentSha256,
        observedContentSha256: policyOverrideRetirementHistory.contentSha256,
        retirementCount: 2,
        observedRetirementCount: 1,
      }),
    );
    await expect(
      store.listExecutionPlanBlueprintRecommendationPolicyOverrides(),
    ).resolves.toEqual(
      expect.objectContaining({
        overrideCount: 0,
        overrides: [],
        overrideSetSha256: policyOverrideRetirement.remainingOverrideSetSha256,
      }),
    );
    const postRetirementSelection =
      await store.selectExecutionPlanBlueprintRecord(selectionThread.id);
    expect(postRetirementSelection).toEqual(
      expect.objectContaining({
        selectedRecordId: first.record.id,
        selectedRecommendationScoreBps: 7_600,
        selectedRecommendationPolicyTemplate: "balanced",
        selectedRecommendationPolicySource: "default",
        familyPolicyOverrideCount: 0,
      }),
    );
    await expect(
      store.setExecutionPlanBlueprintRecommendationPolicyOverride({
        familySha256: selection.selectedFamilySha256!,
        policyTemplate: "balanced",
        expectedPortfolioSetSha256: "0".repeat(64),
      }),
    ).rejects.toThrow(
      "Execution plan blueprint recommendation policy override portfolio set changed",
    );
    const secondPreview = await store.previewPlanFromBlueprintRecord(
      targetThread.id,
      {
        recordId: first.record.id,
      },
    );
    expect(secondPreview.status).toBe("ready");
    await store.createPlanFromBlueprintRecord(targetThread.id, {
      recordId: first.record.id,
      expectedPreviewSha256: secondPreview.previewSha256,
    });
    await expect(
      store.qualifyExecutionPlanBlueprintRecordOutcomes(first.record.id),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "policy_failed",
        diagnostics: ["completion_rate_below_min"],
        recordId: first.record.id,
        baselineId: promotedBaseline.baseline.id,
        replayCount: 2,
        completedCount: 1,
        blockedCount: 0,
        invalidCount: 0,
        completionRateBps: 5_000,
      }),
    );
    const failedSelection = await store.selectExecutionPlanBlueprintRecord(
      selectionThread.id,
    );
    expect(failedSelection.selectedRecordId).toBeUndefined();
    expect(failedSelection).toEqual(
      expect.objectContaining({
        candidateCount: 1,
        qualifiedCandidateCount: 0,
        rejectedCandidateCount: 1,
        candidates: [
          expect.objectContaining({
            recordId: first.record.id,
            selectionStatus: "rejected",
            sourceQualificationStatus: "qualified",
            outcomeQualificationStatus: "policy_failed",
            diagnostics: [
              "outcome_policy_failed",
              "outcome_completion_rate_below_min",
            ],
          }),
        ],
      }),
    );
    await expect(
      store.verifyExecutionPlanBlueprintRecordReplayOutcomes(
        first.record.id,
        replayOutcomes,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: expect.arrayContaining([
          "current_outcomes_mismatch",
          "outcome_set_mismatch",
          "completed_count_mismatch",
        ]),
        completedCount: 0,
        observedCompletedCount: 1,
      }),
    );
    await store.appendEvent({
      threadId: sourceThread.id,
      runId: "runctl_library",
      type: "plan.audit",
      category: "plan",
      visibility: "debug",
      payload: {
        planId: sourcePlan.id,
        blueprintSha256: blueprint.contentSha256,
      },
    });
    await expect(
      store.qualifyExecutionPlanBlueprintRecord(first.record.id),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "source_drift",
        diagnostics: ["source_drift"],
        recordId: first.record.id,
        expectedPlanArchiveSha256: first.record.sourcePlanArchiveSha256,
        expectedEventStreamSha256: first.record.sourceEventStreamSha256,
        actualPlanArchiveSha256: expect.not.stringMatching(
          first.record.sourcePlanArchiveSha256,
        ),
        actualEventStreamSha256: expect.not.stringMatching(
          first.record.sourceEventStreamSha256,
        ),
      }),
    );
    const driftTargetThread = await store.createThread({
      title: "Blueprint drift target",
      agentId: agent.id,
    });
    await expect(
      store.previewPlanFromBlueprintRecord(driftTargetThread.id, {
        recordId: first.record.id,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "not_qualified",
        diagnostics: ["source_drift"],
        recordId: first.record.id,
        hasOpenPlan: false,
      }),
    );
    await expect(
      store.createPlanFromBlueprintRecord(driftTargetThread.id, {
        recordId: first.record.id,
      }),
    ).rejects.toThrow("Execution plan blueprint record is not ready");
  });
});
