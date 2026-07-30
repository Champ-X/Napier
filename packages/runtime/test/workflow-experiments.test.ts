import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA } from "@napier/contracts";
import type {
  ExecutionPlanWorkflowExperimentComparison,
  ExecutionPlanWorkflowManifest,
  WorkflowObjectSchema,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { ModelRegistry } from "../src/models.js";
import {
  createRunReplaySnapshot,
  exportThreadReplayBundle,
  hashEventStream,
} from "../src/replay.js";
import { streamSnapshotFrame } from "../src/run-stream.js";
import { LocalStore } from "../src/store.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";
import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";
import { validateExecutionPlanWorkflowExperimentComparison } from "../src/workflow-experiment-comparison-protocol.js";
import {
  createExecutionPlanWorkflowExperimentResultFrame,
  validateExecutionPlanWorkflowExperimentResult,
  validateExecutionPlanWorkflowExperimentResultFrame,
} from "../src/workflow-experiment-protocol.js";
import { ExecutionPlanWorkflowExperimentRuntime } from "../src/workflow-experiments.js";
import { defineExecutionPlanWorkflow } from "../src/workflow-manifests.js";
import { ExecutionPlanWorkflowRuntime } from "../src/workflow-runtime.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Execution Plan Workflow experiments", () => {
  it("reuses verified ancestors and reruns one checkpoint with a replacement model", async () => {
    const fixture = await createFixture();
    await seedSourceEvaluation(fixture);
    const sourcePlanBefore = fixture.store.getPlan(fixture.sourceResult.planId);
    fixture.alternate.setResponses([
      fauxAssistantMessage('{"report":"Experimental report","approved":true}'),
    ]);
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      experimentRequest(fixture, {
        modelOverrides: {
          report: { provider: "faux-workflow-alternate", id: "faux-1" },
        },
      }),
    );
    expect(preview).toEqual(
      expect.objectContaining({
        fromNodeId: "report",
        reusedNodeIds: ["inspect"],
        rerunNodeIds: ["report"],
        requiresSideEffectConfirmation: false,
      }),
    );
    let targetThreadId = "";
    const experiment = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: experimentRequest(fixture, {
        modelOverrides: {
          report: { provider: "faux-workflow-alternate", id: "faux-1" },
        },
      }),
      onTargetCreated: (thread) => {
        targetThreadId = thread.id;
      },
    });

    expect(experiment).toEqual(
      expect.objectContaining({
        targetThreadId,
        sourceManifest: expect.objectContaining({ maxConcurrency: 2 }),
        candidateManifest: expect.objectContaining({ maxConcurrency: 2 }),
        result: expect.objectContaining({
          status: "completed",
          output: { report: "Experimental report", approved: true },
        }),
      }),
    );
    expect(validateExecutionPlanWorkflowExperimentResult(experiment)).toEqual(
      experiment,
    );
    const legacyResult = structuredClone(experiment);
    delete legacyResult.comparison;
    expect(validateExecutionPlanWorkflowExperimentResult(legacyResult)).toEqual(
      legacyResult,
    );
    expect(experiment.comparison).toEqual(
      expect.objectContaining({
        sourceThreadId: fixture.sourceThreadId,
        targetThreadId,
        sourceStatus: "completed",
        targetStatus: "completed",
        inputChange: "unchanged",
        outputChange: "changed",
        reusedNodeCount: 1,
        rerunNodeCount: 1,
        sourceEvaluations: expect.objectContaining({
          total: 1,
          rightBetter: 1,
        }),
        targetEvaluations: expect.objectContaining({ total: 0 }),
        changedNodeIds: ["report"],
      }),
    );
    expect(experiment.comparison?.nodes).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        execution: "reused",
        modelChanged: false,
        configurationChanged: false,
        inputChange: "unchanged",
        outputChange: "unchanged",
        target: expect.objectContaining({
          models: [{ provider: "napier", id: "workflow-reuse" }],
          metrics: expect.objectContaining({
            runCount: 1,
            modelResponseCount: 0,
          }),
        }),
      }),
      expect.objectContaining({
        nodeId: "report",
        execution: "rerun",
        modelChanged: true,
        configurationChanged: true,
        inputChange: "unchanged",
        outputChange: "changed",
        target: expect.objectContaining({
          models: [{ provider: "faux-workflow-alternate", id: "faux-1" }],
        }),
      }),
    ]);
    expect(JSON.stringify(experiment.comparison)).not.toContain(
      "Source report",
    );
    expect(JSON.stringify(experiment.comparison)).not.toContain(
      "Experimental report",
    );
    expect(fixture.store.getPlan(fixture.sourceResult.planId)).toEqual(
      sourcePlanBefore,
    );
    const targetRuns = fixture.store.listRuns(targetThreadId);
    expect(targetRuns).toHaveLength(2);
    expect(targetRuns[0]).toEqual(
      expect.objectContaining({
        source: "workflow_reuse",
        status: "completed",
        configuration: expect.objectContaining({
          model: { provider: "napier", id: "workflow-reuse" },
        }),
      }),
    );
    expect(targetRuns[1]?.configuration?.model).toEqual({
      provider: "faux-workflow-alternate",
      id: "faux-1",
    });
    const targetEvents = await fixture.store.listEvents(targetThreadId);
    expect(
      targetEvents.filter((event) => event.type === "workflow.node.reused"),
    ).toHaveLength(1);
    expect(
      targetEvents.filter(
        (event) => event.type === "workflow.experiment.started",
      ),
    ).toHaveLength(1);
    expect(
      targetEvents.filter(
        (event) => event.type === "workflow.experiment.compared",
      ),
    ).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          comparisonSha256: experiment.comparison?.contentSha256,
          changedNodeCount: 1,
          outputChange: "changed",
        }),
      }),
    ]);
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, targetThreadId),
      ).status,
    ).toBe("valid");
    const snapshot = streamSnapshotFrame(
      await fixture.store.getDetail(targetThreadId),
    );
    const frame = createExecutionPlanWorkflowExperimentResultFrame(
      experiment,
      snapshot,
      hashEventStream(snapshot.detail.events),
    );
    expect(validateExecutionPlanWorkflowExperimentResultFrame(frame)).toEqual(
      frame,
    );
    const tampered = structuredClone(frame);
    tampered.experiment.result.output = {
      report: "TAMPERED",
      approved: true,
    };
    expect(() =>
      validateExecutionPlanWorkflowExperimentResultFrame(tampered),
    ).toThrow();
    const tamperedComparison = structuredClone(frame);
    tamperedComparison.experiment.comparison!.metricDelta.costUsd += 1;
    expect(() =>
      validateExecutionPlanWorkflowExperimentResultFrame(tamperedComparison),
    ).toThrow();
    const forgedRunSource = structuredClone(frame);
    forgedRunSource.experiment.comparison!.nodes[1]!.target.runSources = [
      "user",
    ];
    expect(() =>
      validateExecutionPlanWorkflowExperimentResultFrame(forgedRunSource),
    ).toThrow("run sources");
    for (const field of [
      "runSources",
      "models",
      "configurationSha256s",
    ] as const) {
      const incompleteObservation = structuredClone(experiment.comparison!);
      incompleteObservation.nodes[1]!.target[field] = [];
      expect(() =>
        validateExecutionPlanWorkflowExperimentComparison(
          rehashComparison(incompleteObservation),
        ),
      ).toThrow();
    }
    const duplicatedSourceRun = structuredClone(experiment.comparison!);
    duplicatedSourceRun.nodes[1]!.source.runIds = [
      ...duplicatedSourceRun.nodes[0]!.source.runIds,
    ];
    duplicatedSourceRun.nodes[1]!.source.runSources = [
      ...duplicatedSourceRun.nodes[0]!.source.runSources,
    ];
    duplicatedSourceRun.nodes[1]!.source.models = structuredClone(
      duplicatedSourceRun.nodes[0]!.source.models,
    );
    duplicatedSourceRun.nodes[1]!.source.configurationSha256s = [
      ...duplicatedSourceRun.nodes[0]!.source.configurationSha256s,
    ];
    expect(() =>
      validateExecutionPlanWorkflowExperimentComparison(
        rehashComparison(duplicatedSourceRun),
      ),
    ).toThrow("comparison binding");
    const nonIsolatedComparison = structuredClone(experiment.comparison!);
    nonIsolatedComparison.targetThreadId = nonIsolatedComparison.sourceThreadId;
    expect(() =>
      validateExecutionPlanWorkflowExperimentComparison(
        rehashComparison(nonIsolatedComparison),
      ),
    ).toThrow("comparison is invalid");
    fixture.alternate.setResponses([
      fauxAssistantMessage('{"report":"Nested experiment","approved":true}'),
    ]);
    const nested = await fixture.experiments.run({
      sourceThreadId: experiment.targetThreadId,
      request: {
        manifest: experiment.candidateManifest,
        planId: experiment.result.planId,
        fromNodeId: "report",
      },
    });
    expect(nested.result.output).toEqual({
      report: "Nested experiment",
      approved: true,
    });
    expect(nested.comparison).toEqual(
      expect.objectContaining({
        inputChange: "unchanged",
        outputChange: "changed",
        changedNodeIds: ["report"],
      }),
    );
    expect(
      fixture.store.listRuns(nested.targetThreadId).map((run) => run.source),
    ).toEqual(["workflow_reuse", "workflow"]);
    fixture.store.close();
  }, 20_000);

  it("requires a current preview hash before rerunning write-effect evidence", async () => {
    const fixture = await createFixture();
    const reportRunId = fixture.sourceResult.nodeResults[1]!.runId!;
    await fixture.store.appendEvent({
      threadId: fixture.sourceThreadId,
      runId: reportRunId,
      type: "tool.started",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_write_effect",
        toolName: "apply_patch",
        status: "started",
        effect: "write",
      },
    });
    await fixture.store.appendEvent({
      threadId: fixture.sourceThreadId,
      runId: reportRunId,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_write_effect",
        toolName: "apply_patch",
        status: "completed",
        effect: "write",
      },
    });
    const request = experimentRequest(fixture);
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      request,
    );
    expect(preview).toEqual(
      expect.objectContaining({
        requiresSideEffectConfirmation: true,
        toolEffects: [
          expect.objectContaining({
            nodeId: "report",
            writeCount: 1,
            writeToolNames: ["apply_patch"],
          }),
        ],
      }),
    );
    const threadCount = fixture.store.listThreads().length;
    await expect(
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request,
      }),
    ).rejects.toThrow("explicit confirmation");
    await expect(
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: {
          ...request,
          confirmSideEffects: true,
          expectedPreviewSha256: "f".repeat(64),
        },
      }),
    ).rejects.toThrow("preview changed");
    expect(fixture.store.listThreads()).toHaveLength(threadCount);

    await fixture.store.appendEvent({
      threadId: fixture.sourceThreadId,
      runId: reportRunId,
      type: "tool.started",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_read_after_preview",
        toolName: "read_file",
        status: "started",
        effect: "read",
      },
    });
    await fixture.store.appendEvent({
      threadId: fixture.sourceThreadId,
      runId: reportRunId,
      type: "tool.started",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_unknown_after_preview",
        toolName: "third_party_action",
        status: "started",
      },
    });
    await fixture.store.appendEvent({
      threadId: fixture.sourceThreadId,
      runId: reportRunId,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_read_after_preview",
        toolName: "read_file",
        status: "completed",
        effect: "read",
      },
    });
    await expect(
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: {
          ...request,
          confirmSideEffects: true,
          expectedPreviewSha256: preview.previewSha256,
        },
      }),
    ).rejects.toThrow("preview changed");
    const currentPreview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      request,
    );
    expect(currentPreview.toolEffects[0]).toEqual(
      expect.objectContaining({
        readOnlyCount: 1,
        writeCount: 1,
        unknownCount: 1,
        unresolvedCount: 1,
        unknownToolNames: ["third_party_action"],
      }),
    );
    fixture.primary.setResponses([
      fauxAssistantMessage('{"report":"Confirmed rerun","approved":true}'),
    ]);
    const confirmed = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...request,
        confirmSideEffects: true,
        expectedPreviewSha256: currentPreview.previewSha256,
      },
    });
    expect(confirmed.result.output).toEqual({
      report: "Confirmed rerun",
      approved: true,
    });
    expect(confirmed.comparison?.nodes[1]).toEqual(
      expect.objectContaining({
        removedToolNames: ["apply_patch", "read_file", "third_party_action"],
        metricDelta: expect.objectContaining({ toolCallCount: -3 }),
      }),
    );
    fixture.store.close();
  }, 20_000);

  it("resumes a blocked experiment and isolates concurrent experiment targets", async () => {
    const fixture = await createFixture();
    fixture.primary.setResponses([fauxAssistantMessage("not json")]);
    const blocked = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: experimentRequest(fixture),
    });
    expect(blocked.result.status).toBe("blocked");
    expect(blocked.comparison).toEqual(
      expect.objectContaining({
        targetStatus: "blocked",
        outputChange: "became_unavailable",
      }),
    );
    expect(blocked.comparison?.nodes[1]?.target.status).toBe("blocked");
    fixture.primary.setResponses([
      fauxAssistantMessage('{"report":"Recovered fork","approved":true}'),
    ]);
    const recovered = await fixture.workflows.run({
      threadId: blocked.targetThreadId,
      request: {
        manifest: blocked.candidateManifest,
        planId: blocked.result.planId,
        retryBlocked: true,
      },
    });
    expect(recovered.output).toEqual({
      report: "Recovered fork",
      approved: true,
    });

    fixture.primary.setResponses([
      fauxAssistantMessage('{"report":"Concurrent A","approved":true}'),
      fauxAssistantMessage('{"report":"Concurrent B","approved":true}'),
    ]);
    const [left, right] = await Promise.all([
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: experimentRequest(fixture),
      }),
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: experimentRequest(fixture),
      }),
    ]);
    expect(left.targetThreadId).not.toBe(right.targetThreadId);
    expect([left.result.status, right.result.status]).toEqual([
      "completed",
      "completed",
    ]);
    fixture.store.close();
  }, 20_000);

  it("distinguishes a repaired blocked source from a lost target output", async () => {
    const fixture = await createFixture();
    await fixture.store.transitionPlanStep(
      fixture.sourceResult.planId,
      "report",
      { action: "reopen" },
    );
    await fixture.store.transitionPlanStep(
      fixture.sourceResult.planId,
      "report",
      {
        action: "block",
        blocker: "Source report requires a new experiment.",
        evidence: "The prior completed output was explicitly reopened.",
      },
    );
    fixture.primary.setResponses([
      fauxAssistantMessage('{"report":"Repaired source","approved":true}'),
    ]);
    const repaired = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: experimentRequest(fixture),
    });
    expect(repaired.comparison).toEqual(
      expect.objectContaining({
        sourceStatus: "blocked",
        targetStatus: "completed",
        outputChange: "became_available",
      }),
    );
    expect(repaired.comparison?.nodes[1]).toEqual(
      expect.objectContaining({
        source: expect.objectContaining({
          status: "blocked",
        }),
        target: expect.objectContaining({ status: "completed" }),
        outputChange: "became_available",
      }),
    );
    expect(repaired.comparison?.nodes[1]?.source.outputSha256).toBeUndefined();
    fixture.store.close();
  }, 20_000);

  it("settles cancellation in the experiment Thread without changing the source", async () => {
    const fixture = await createFixture();
    const sourcePlan = fixture.store.getPlan(fixture.sourceResult.planId);
    fixture.primary.setResponses([
      fauxAssistantMessage(`{"report":"${"x".repeat(500)}","approved":true}`),
    ]);
    const controller = new AbortController();
    const cancelled = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: experimentRequest(fixture),
      signal: controller.signal,
      onEvent: (event) => {
        if (
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "report"
        ) {
          controller.abort();
        }
      },
    });
    expect(cancelled.result.status).toBe("cancelled");
    expect(cancelled.comparison).toEqual(
      expect.objectContaining({
        targetStatus: "cancelled",
        outputChange: "became_unavailable",
      }),
    );
    expect(fixture.store.getPlan(fixture.sourceResult.planId)).toEqual(
      sourcePlan,
    );
    expect(
      (await fixture.store.listEvents(cancelled.targetThreadId)).some(
        (event) => event.type === "workflow.cancelled",
      ),
    ).toBe(true);
    fixture.store.close();
  }, 20_000);

  it("recovers cancellation before ancestor reuse without executing that ancestor", async () => {
    const fixture = await createFixture();
    const controller = new AbortController();
    const cancelled = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: experimentRequest(fixture, {
        modelOverrides: {
          report: { provider: "faux-workflow-alternate", id: "faux-1" },
        },
      }),
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "workflow.experiment.started") {
          controller.abort();
        }
      },
    });
    expect(cancelled.result.status).toBe("cancelled");
    expect(cancelled.comparison?.targetMetrics.runCount).toBe(0);
    expect(cancelled.comparison?.nodes[0]?.target.status).toBe("ready");
    expect(fixture.store.listRuns(cancelled.targetThreadId)).toEqual([]);

    fixture.alternate.setResponses([
      fauxAssistantMessage(
        '{"report":"Recovered after reuse","approved":true}',
      ),
    ]);
    const recovered = await fixture.workflows.run({
      threadId: cancelled.targetThreadId,
      request: {
        manifest: cancelled.candidateManifest,
        planId: cancelled.result.planId,
      },
    });
    expect(recovered.output).toEqual({
      report: "Recovered after reuse",
      approved: true,
    });
    expect(
      fixture.store.listRuns(cancelled.targetThreadId).map((run) => run.source),
    ).toEqual(["workflow_reuse", "workflow"]);
    expect(
      (await fixture.store.listEvents(cancelled.targetThreadId)).filter(
        (event) => event.type === "workflow.node.reused",
      ),
    ).toHaveLength(1);
    fixture.store.close();
  }, 20_000);

  it("fails comparison closed when the source Plan changes during the target run", async () => {
    const fixture = await createFixture();
    fixture.primary.setResponses([
      fauxAssistantMessage('{"report":"Stale comparison","approved":true}'),
    ]);
    let targetThreadId = "";
    let sourceReopened = false;
    await expect(
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: experimentRequest(fixture),
        onTargetCreated: (thread) => {
          targetThreadId = thread.id;
        },
        onEvent: async (event) => {
          if (
            !sourceReopened &&
            event.type === "workflow.node.started" &&
            record(event.payload)?.["nodeId"] === "report"
          ) {
            sourceReopened = true;
            await fixture.store.transitionPlanStep(
              fixture.sourceResult.planId,
              "report",
              { action: "reopen" },
            );
          }
        },
      }),
    ).rejects.toThrow("Plan binding");
    expect(sourceReopened).toBe(true);
    expect(targetThreadId).not.toBe("");
    expect(
      (await fixture.store.listEvents(targetThreadId)).some(
        (event) => event.type === "workflow.experiment.failed",
      ),
    ).toBe(true);
    fixture.store.close();
  }, 20_000);

  it("rejects source evidence ambiguity and pre-abort without creating a target Thread", async () => {
    const fixture = await createFixture();
    const before = fixture.store.listThreads().length;
    const controller = new AbortController();
    controller.abort();
    await expect(
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: experimentRequest(fixture),
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(fixture.store.listThreads()).toHaveLength(before);

    const events = await fixture.store.listEvents(fixture.sourceThreadId);
    const completed = events.find(
      (event) =>
        event.type === "workflow.node.completed" &&
        event.runId === fixture.sourceResult.nodeResults[0]!.runId,
    )!;
    await fixture.store.appendEvent({
      threadId: completed.threadId,
      runId: completed.runId,
      type: completed.type,
      category: completed.category,
      visibility: completed.visibility,
      payload: completed.payload,
    });
    await expect(
      fixture.experiments.preview(
        fixture.sourceThreadId,
        experimentRequest(fixture),
      ),
    ).rejects.toThrow("ambiguous");
    await expect(
      fixture.experiments.preview(fixture.sourceThreadId, {
        ...experimentRequest(fixture),
        modelOverrides: {
          inspect: { provider: "faux-workflow-alternate", id: "faux-1" },
        },
      }),
    ).rejects.toThrow("reused node model");
    expect(fixture.store.listThreads()).toHaveLength(before);
    fixture.store.close();
  });

  it("reruns and reuses a Tool checkpoint without allowing a model override", async () => {
    const fixture = await createFixture({ toolInspect: true });
    fixture.primary.setResponses([
      fauxAssistantMessage(
        '{"report":"Tool checkpoint rerun","approved":true}',
      ),
    ]);
    const rerunPreview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      {
        ...experimentRequest(fixture),
        fromNodeId: "inspect",
      },
    );
    expect(rerunPreview).toEqual(
      expect.objectContaining({
        reusedNodeIds: [],
        rerunNodeIds: ["inspect", "report"],
        requiresSideEffectConfirmation: false,
        toolEffects: [
          expect.objectContaining({
            nodeId: "inspect",
            toolCallCount: 1,
            readOnlyCount: 1,
            writeCount: 0,
          }),
          expect.objectContaining({ nodeId: "report" }),
        ],
      }),
    );

    const rerun = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...experimentRequest(fixture),
        fromNodeId: "inspect",
      },
    });
    expect(rerun.result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { report: "Tool checkpoint rerun", approved: true },
      }),
    );
    expect(rerun.comparison?.nodes[0]).toEqual(
      expect.objectContaining({
        nodeId: "inspect",
        execution: "rerun",
        modelChanged: false,
        source: expect.objectContaining({ toolNames: ["list_files"] }),
        target: expect.objectContaining({ toolNames: ["list_files"] }),
      }),
    );
    expect(
      (await fixture.store.listEvents(rerun.targetThreadId)).filter(
        (event) =>
          event.type === "tool.started" &&
          record(event.payload)?.["toolName"] === "list_files",
      ),
    ).toHaveLength(1);

    await expect(
      fixture.experiments.preview(fixture.sourceThreadId, {
        ...experimentRequest(fixture),
        fromNodeId: "inspect",
        modelOverrides: {
          inspect: { provider: "faux-workflow-alternate", id: "faux-1" },
        },
      }),
    ).rejects.toThrow("non-Agent node model");

    fixture.alternate.setResponses([
      fauxAssistantMessage(
        '{"report":"Tool checkpoint reused","approved":true}',
      ),
    ]);
    const reused = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: experimentRequest(fixture, {
        modelOverrides: {
          report: { provider: "faux-workflow-alternate", id: "faux-1" },
        },
      }),
    });
    expect(reused.result.output).toEqual({
      report: "Tool checkpoint reused",
      approved: true,
    });
    expect(reused.result.nodeResults[0]?.output).toEqual(
      fixture.sourceResult.nodeResults[0]?.output,
    );
    expect(
      fixture.store.listRuns(reused.targetThreadId).map((run) => run.source),
    ).toEqual(["workflow_reuse", "workflow"]);
    fixture.store.close();
  });

  it("reruns and reuses a Deterministic checkpoint without a model call", async () => {
    const fixture = await createFixture({ deterministicInspect: true });
    fixture.primary.setResponses([
      fauxAssistantMessage(
        '{"report":"Deterministic checkpoint rerun","approved":true}',
      ),
    ]);
    const preview = await fixture.experiments.preview(fixture.sourceThreadId, {
      ...experimentRequest(fixture),
      fromNodeId: "inspect",
    });
    expect(preview).toEqual(
      expect.objectContaining({
        reusedNodeIds: [],
        rerunNodeIds: ["inspect", "report"],
        requiresSideEffectConfirmation: false,
        toolEffects: [
          expect.objectContaining({
            nodeId: "inspect",
            attemptCount: 1,
            toolCallCount: 0,
          }),
          expect.objectContaining({ nodeId: "report" }),
        ],
      }),
    );

    const rerun = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...experimentRequest(fixture),
        fromNodeId: "inspect",
      },
    });
    expect(rerun.result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: {
          report: "Deterministic checkpoint rerun",
          approved: true,
        },
      }),
    );
    expect(rerun.comparison?.nodes[0]).toEqual(
      expect.objectContaining({
        nodeId: "inspect",
        execution: "rerun",
        modelChanged: false,
        source: expect.objectContaining({ toolNames: [] }),
        target: expect.objectContaining({ toolNames: [] }),
      }),
    );
    const targetEvents = await fixture.store.listEvents(rerun.targetThreadId);
    const deterministicRunId = rerun.result.nodeResults[0]?.runId;
    expect(
      targetEvents.filter(
        (event) =>
          event.type === "workflow.deterministic.completed" &&
          event.runId === deterministicRunId,
      ),
    ).toHaveLength(1);
    expect(
      targetEvents.some(
        (event) =>
          event.type === "model.response" && event.runId === deterministicRunId,
      ),
    ).toBe(false);

    await expect(
      fixture.experiments.preview(fixture.sourceThreadId, {
        ...experimentRequest(fixture),
        fromNodeId: "inspect",
        modelOverrides: {
          inspect: { provider: "faux-workflow-alternate", id: "faux-1" },
        },
      }),
    ).rejects.toThrow("non-Agent node model");

    fixture.alternate.setResponses([
      fauxAssistantMessage(
        '{"report":"Deterministic checkpoint reused","approved":true}',
      ),
    ]);
    const reused = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: experimentRequest(fixture, {
        modelOverrides: {
          report: { provider: "faux-workflow-alternate", id: "faux-1" },
        },
      }),
    });
    expect(reused.result.output).toEqual({
      report: "Deterministic checkpoint reused",
      approved: true,
    });
    expect(reused.result.nodeResults[0]?.output).toEqual(
      fixture.sourceResult.nodeResults[0]?.output,
    );
    expect(
      fixture.store.listRuns(reused.targetThreadId).map((run) => run.source),
    ).toEqual(["workflow_reuse", "workflow"]);
    fixture.store.close();
  });

  it("reuses a verified Approval and reruns it as an isolated waiting checkpoint", async () => {
    const fixture = await createFixture({ approvalInspect: true });
    fixture.alternate.setResponses([
      fauxAssistantMessage(
        '{"report":"Approval checkpoint reused","approved":true}',
      ),
    ]);
    const reused = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: experimentRequest(fixture, {
        modelOverrides: {
          report: { provider: "faux-workflow-alternate", id: "faux-1" },
        },
      }),
    });
    expect(reused.result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: {
          report: "Approval checkpoint reused",
          approved: true,
        },
      }),
    );
    expect(reused.result.nodeResults[0]?.output).toEqual(
      fixture.sourceResult.nodeResults[0]?.output,
    );
    expect(
      await fixture.store.listOperatorDecisions(reused.targetThreadId),
    ).toEqual([]);

    await expect(
      fixture.experiments.preview(fixture.sourceThreadId, {
        ...experimentRequest(fixture),
        fromNodeId: "inspect",
        modelOverrides: {
          inspect: { provider: "faux-workflow-alternate", id: "faux-1" },
        },
      }),
    ).rejects.toThrow("non-Agent node model");

    const rerun = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...experimentRequest(fixture),
        fromNodeId: "inspect",
      },
    });
    expect(rerun.result).toEqual(
      expect.objectContaining({
        status: "waiting",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            status: "waiting",
            decisionId: expect.stringMatching(/^decision_[a-z0-9]{20}$/u),
          }),
        ],
      }),
    );
    expect(
      await fixture.store.listOperatorDecisions(rerun.targetThreadId),
    ).toEqual([
      expect.objectContaining({
        status: "pending",
        question: "Approve this experiment checkpoint?",
      }),
    ]);
    expect(rerun.comparison?.nodes[0]).toEqual(
      expect.objectContaining({
        nodeId: "inspect",
        execution: "rerun",
        modelChanged: false,
        target: expect.objectContaining({ status: "running" }),
      }),
    );
    fixture.store.close();
  });
});

interface Fixture {
  store: LocalStore;
  sourceThreadId: string;
  manifest: ExecutionPlanWorkflowManifest;
  sourceResult: Awaited<ReturnType<ExecutionPlanWorkflowRuntime["run"]>>;
  primary: ReturnType<typeof fauxProvider>;
  alternate: ReturnType<typeof fauxProvider>;
  workflows: ExecutionPlanWorkflowRuntime;
  experiments: ExecutionPlanWorkflowExperimentRuntime;
}

async function createFixture(
  options: {
    toolInspect?: boolean;
    approvalInspect?: boolean;
    deterministicInspect?: boolean;
  } = {},
): Promise<Fixture> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-workflow-experiment-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const blueprintThread = store.listThreads()[0]!;
  const blueprintPlan = await store.createPlan(blueprintThread.id, {
    objective: "Inspect input and produce a typed experiment report.",
    steps: [
      {
        id: "inspect",
        title: "Inspect",
        description: "Inspect the typed Workflow input.",
        verification: "Return typed inspection JSON.",
      },
      {
        id: "report",
        title: "Report",
        description: "Produce the final typed report.",
        verification: "Return typed report JSON.",
        dependsOn: ["inspect"],
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    store,
    blueprintThread.id,
    blueprintPlan.id,
  );
  const sourceThread = await store.createThread({
    title: "Workflow experiment source",
    agentId: blueprintThread.agentId,
  });
  const primary = fauxProvider({ provider: "faux-workflow-primary" });
  const alternate = fauxProvider({ provider: "faux-workflow-alternate" });
  const models = new ModelRegistry();
  models.registerProvider(primary.provider);
  models.registerProvider(alternate.provider);
  const runtime = new AgentRuntime(store, models);
  const workflows = new ExecutionPlanWorkflowRuntime(store, runtime);
  const manifest = defineExecutionPlanWorkflow({
    name: "Experiment report",
    version: 1,
    description: "Exercise controlled Workflow checkpoint reruns.",
    blueprint,
    inputSchema: requestSchema(),
    outputSchema: reportSchema(),
    outputNodeId: "report",
    maxConcurrency: 2,
    nodes: [
      {
        id: "inspect",
        ...(options.approvalInspect
          ? {
              type: "approval" as const,
              header: "Release",
              question: "Approve this experiment checkpoint?",
              approve: {
                label: "Approve",
                description: "Continue to the report Agent.",
              },
              reject: {
                label: "Reject",
                description: "Block the experiment Workflow.",
              },
              inputBindings: {
                workflow: { source: "workflow" as const },
              },
              inputSchema: {
                type: "object" as const,
                properties: { workflow: requestSchema() },
                required: ["workflow"],
                additionalProperties: false as const,
              },
              outputSchema: structuredClone(
                EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA,
              ),
              timeoutMs: 60_000,
              maxAttempts: 2,
            }
          : options.toolInspect
            ? {
                type: "tool" as const,
                tool: "list_files" as const,
                effect: "read" as const,
                inputBindings: {
                  path: { source: "literal" as const, value: "." },
                  depth: { source: "literal" as const, value: 1 },
                },
                inputSchema: {
                  type: "object" as const,
                  properties: {
                    path: {
                      type: "string" as const,
                      minLength: 1,
                      maxLength: 20,
                    },
                    depth: {
                      type: "integer" as const,
                      minimum: 0,
                      maximum: 4,
                    },
                  },
                  required: ["path", "depth"],
                  additionalProperties: false as const,
                },
                outputSchema: listFilesReceiptSchema(),
                timeoutMs: 5_000,
                maxAttempts: 2,
              }
            : options.deterministicInspect
              ? {
                  type: "deterministic" as const,
                  inputBindings: {
                    workflow: { source: "workflow" as const },
                  },
                  inputSchema: {
                    type: "object" as const,
                    properties: { workflow: requestSchema() },
                    required: ["workflow"],
                    additionalProperties: false as const,
                  },
                  outputSchema: inspectionSchema(),
                  template: {
                    kind: "object" as const,
                    properties: {
                      summary: {
                        kind: "input" as const,
                        path: ["workflow", "request"],
                      },
                      count: { kind: "literal" as const, value: 1 },
                    },
                  },
                  timeoutMs: 5_000,
                  maxAttempts: 2,
                }
              : {
                  type: "agent" as const,
                  inputBindings: {
                    workflow: { source: "workflow" as const },
                  },
                  inputSchema: {
                    type: "object" as const,
                    properties: { workflow: requestSchema() },
                    required: ["workflow"],
                    additionalProperties: false as const,
                  },
                  outputSchema: inspectionSchema(),
                  model: {
                    provider: "faux-workflow-primary",
                    id: "faux-1",
                  },
                  timeoutMs: 5_000,
                  maxAttempts: 2,
                }),
      },
      {
        id: "report",
        type: "agent",
        inputBindings: {
          workflow: { source: "workflow" },
          [options.approvalInspect
            ? "approval"
            : options.toolInspect
              ? "inventory"
              : "inspection"]: {
            source: "node",
            nodeId: "inspect",
          },
        },
        inputSchema: {
          type: "object",
          properties: {
            workflow: requestSchema(),
            [options.approvalInspect
              ? "approval"
              : options.toolInspect
                ? "inventory"
                : "inspection"]: options.approvalInspect
              ? structuredClone(EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA)
              : options.toolInspect
                ? listFilesReceiptSchema()
                : inspectionSchema(),
          },
          required: [
            "workflow",
            options.approvalInspect
              ? "approval"
              : options.toolInspect
                ? "inventory"
                : "inspection",
          ],
          additionalProperties: false,
        },
        outputSchema: reportSchema(),
        model: { provider: "faux-workflow-primary", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  });
  primary.setResponses(
    options.toolInspect ||
      options.approvalInspect ||
      options.deterministicInspect
      ? [fauxAssistantMessage('{"report":"Source report","approved":true}')]
      : [
          fauxAssistantMessage('{"summary":"Source inspection","count":1}'),
          fauxAssistantMessage('{"report":"Source report","approved":true}'),
        ],
  );
  let sourceResult = await workflows.run({
    threadId: sourceThread.id,
    request: {
      manifest,
      input: { request: "Produce the source report." },
    },
  });
  if (options.approvalInspect) {
    const decision = (await store.listOperatorDecisions(sourceThread.id))[0]!;
    await store.answerOperatorDecision(sourceThread.id, decision.id, {
      selectedOptionIds: ["option_1"],
      customText: "Approve the experiment source.",
    });
    sourceResult = await workflows.run({
      threadId: sourceThread.id,
      request: {
        manifest,
        planId: sourceResult.planId,
      },
    });
  }
  return {
    store,
    sourceThreadId: sourceThread.id,
    manifest,
    sourceResult,
    primary,
    alternate,
    workflows,
    experiments: new ExecutionPlanWorkflowExperimentRuntime(store, workflows),
  };
}

function experimentRequest(
  fixture: Fixture,
  overrides: {
    modelOverrides?: Record<string, { provider: string; id: string }>;
  } = {},
) {
  return {
    manifest: fixture.manifest,
    planId: fixture.sourceResult.planId,
    fromNodeId: "report",
    ...overrides,
  };
}

function rehashComparison(
  comparison: ExecutionPlanWorkflowExperimentComparison,
): ExecutionPlanWorkflowExperimentComparison {
  const { contentSha256: _contentSha256, ...content } = comparison;
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

async function seedSourceEvaluation(fixture: Fixture): Promise<void> {
  const leftRunId = fixture.sourceResult.nodeResults[0]!.runId!;
  const rightRunId = fixture.sourceResult.nodeResults[1]!.runId!;
  const [left, right] = await Promise.all([
    createRunReplaySnapshot(fixture.store, fixture.sourceThreadId, leftRunId),
    createRunReplaySnapshot(fixture.store, fixture.sourceThreadId, rightRunId),
  ]);
  await fixture.store.saveRunEvaluation({
    id: "evaluation_workflow_compare_12345678",
    threadId: fixture.sourceThreadId,
    leftRunId,
    rightRunId,
    leftSnapshotSha256: left.eventStreamSha256,
    rightSnapshotSha256: right.eventStreamSha256,
    rubric: {
      name: "Workflow experiment fixture",
      criteria: [
        {
          id: "quality",
          name: "Quality",
          description: "Compare the source Workflow node outcomes.",
        },
      ],
    },
    scores: [
      {
        criterionId: "quality",
        leftScore: 3,
        rightScore: 4,
        reason: "The report node completes the fixture.",
      },
    ],
    verdict: "right_better",
    reason: "The report node is the completed source outcome.",
    evidence: "",
    evaluatorModel: { provider: "faux-workflow-primary", id: "faux-1" },
    createdAt: "2026-07-31T00:00:00.000Z",
  });
}

function requestSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      request: { type: "string", minLength: 1, maxLength: 500 },
    },
    required: ["request"],
    additionalProperties: false,
  };
}

function inspectionSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      summary: { type: "string", minLength: 1, maxLength: 500 },
      count: { type: "integer", minimum: 0, maximum: 20 },
    },
    required: ["summary", "count"],
    additionalProperties: false,
  };
}

function reportSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      report: { type: "string", minLength: 1, maxLength: 1_000 },
      approved: { type: "boolean" },
    },
    required: ["report", "approved"],
    additionalProperties: false,
  };
}

function listFilesReceiptSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      count: { type: "integer", minimum: 0 },
      truncated: { type: "boolean" },
      pathSha256: { type: "string", minLength: 64, maxLength: 64 },
      entrySetSha256: { type: "string", minLength: 64, maxLength: 64 },
    },
    required: ["count", "truncated", "pathSha256", "entrySetSha256"],
    additionalProperties: false,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
