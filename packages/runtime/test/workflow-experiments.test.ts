import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA } from "@napier/contracts";
import type {
  ExecutionPlanWorkflowExperimentComparison,
  ExecutionPlanWorkflowExperimentResult,
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

  it("runs one checkpoint and preserves its descendant hold across Store reopen", async () => {
    const fixture = await createFixture();
    const sourceReportRunId = fixture.sourceResult.nodeResults[1]!.runId!;
    await fixture.store.appendEvent({
      threadId: fixture.sourceThreadId,
      runId: sourceReportRunId,
      type: "tool.started",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_descendant_write",
        toolName: "apply_patch",
        status: "started",
        effect: "write",
      },
    });
    await fixture.store.appendEvent({
      threadId: fixture.sourceThreadId,
      runId: sourceReportRunId,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_descendant_write",
        toolName: "apply_patch",
        status: "completed",
        effect: "write",
      },
    });
    const subgraphPreview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      {
        ...experimentRequest(fixture),
        fromNodeId: "inspect",
      },
    );
    expect(subgraphPreview).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        requiresSideEffectConfirmation: true,
        toolEffects: [
          expect.objectContaining({ nodeId: "inspect", writeCount: 0 }),
          expect.objectContaining({ nodeId: "report", writeCount: 1 }),
        ],
      }),
    );
    fixture.primary.setResponses([
      fauxAssistantMessage('{"summary":"Single node inspection","count":1}'),
    ]);
    const request = {
      ...experimentRequest(fixture),
      fromNodeId: "inspect",
      mode: "single_node" as const,
    };
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      request,
    );
    expect(preview).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        mode: "single_node",
        reusedNodeIds: [],
        rerunNodeIds: ["inspect", "report"],
        executionNodeIds: ["inspect"],
        stopBeforeNodeIds: ["report"],
        requiresSideEffectConfirmation: false,
        toolEffects: [
          expect.objectContaining({
            nodeId: "inspect",
            toolCallCount: 0,
          }),
        ],
      }),
    );

    const experiment = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      },
    });
    expect(experiment.result).toEqual(
      expect.objectContaining({
        status: "paused",
        breakpoint: expect.objectContaining({
          nodeId: "report",
          breakpointIndex: 0,
          breakpointCount: 1,
        }),
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            status: "completed",
            output: { summary: "Single node inspection", count: 1 },
          }),
        ],
      }),
    );
    expect(experiment.comparison).toEqual(
      expect.objectContaining({
        targetStatus: "paused",
        reusedNodeCount: 0,
        rerunNodeCount: 2,
      }),
    );
    expect(experiment.comparison?.nodes[1]).toEqual(
      expect.objectContaining({
        nodeId: "report",
        target: expect.objectContaining({
          status: "ready",
          runIds: [],
        }),
      }),
    );
    const forged = structuredClone(experiment);
    if (forged.preview.schemaVersion !== 2) {
      throw new Error("Expected a single-node preview");
    }
    const { previewSha256: _previewSha256, ...forgedPreviewContent } =
      forged.preview;
    forgedPreviewContent.stopBeforeNodeIds = [];
    forged.preview = {
      ...forgedPreviewContent,
      previewSha256: sha256(canonicalJson(forgedPreviewContent)),
    };
    expect(() => validateExecutionPlanWorkflowExperimentResult(forged)).toThrow(
      "result binding",
    );
    const beforeReopen = await fixture.store.listEvents(
      experiment.targetThreadId,
    );
    expect(
      beforeReopen.filter(
        (event) =>
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "inspect",
      ),
    ).toHaveLength(1);
    expect(
      beforeReopen.some(
        (event) =>
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "report",
      ),
    ).toBe(false);

    fixture.store.close();
    const reopened = new LocalStore({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
    });
    await reopened.initialize();
    const models = new ModelRegistry();
    models.registerProvider(fixture.primary.provider);
    const workflows = new ExecutionPlanWorkflowRuntime(
      reopened,
      new AgentRuntime(reopened, models),
    );
    const stillPaused = await workflows.run({
      threadId: experiment.targetThreadId,
      request: {
        manifest: experiment.candidateManifest,
        planId: experiment.result.planId,
      },
    });
    expect(stillPaused).toEqual(
      expect.objectContaining({
        status: "paused",
        breakpoint: experiment.result.breakpoint,
      }),
    );

    fixture.primary.setResponses([
      fauxAssistantMessage(
        '{"report":"Continued after single node","approved":true}',
      ),
    ]);
    const continued = await workflows.run({
      threadId: experiment.targetThreadId,
      request: {
        manifest: experiment.candidateManifest,
        planId: experiment.result.planId,
        continueBreakpoint: true,
      },
    });
    expect(continued).toEqual(
      expect.objectContaining({
        status: "completed",
        output: {
          report: "Continued after single node",
          approved: true,
        },
      }),
    );
    const events = await reopened.listEvents(experiment.targetThreadId);
    expect(
      events.filter(
        (event) =>
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "inspect",
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "report",
      ),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "workflow.breakpoint.continued"),
    ).toHaveLength(1);
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(reopened, experiment.targetThreadId),
      ).status,
    ).toBe("valid");
    reopened.close();
  });

  it("steps one checkpoint before holding the remaining subgraph", async () => {
    const fixture = await createFixture({ deterministicInspect: true });
    const reportRunId = fixture.sourceResult.nodeResults[1]!.runId!;
    for (const type of ["tool.started", "tool.completed"]) {
      await fixture.store.appendEvent({
        threadId: fixture.sourceThreadId,
        runId: reportRunId,
        type,
        category: "tool",
        visibility: "user",
        payload: {
          callId: "call_step_descendant_write",
          toolName: "apply_patch",
          status: type === "tool.started" ? "started" : "completed",
          effect: "write",
        },
      });
    }
    const request = {
      ...experimentRequest(fixture),
      fromNodeId: "inspect",
      mode: "step_nodes" as const,
    };
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      request,
    );
    expect(preview).toEqual(
      expect.objectContaining({
        schemaVersion: 5,
        mode: "step_nodes",
        rerunNodeIds: ["inspect", "report"],
        executionNodeIds: ["inspect"],
        stopBeforeNodeIds: ["report"],
        requiresSideEffectConfirmation: true,
        toolEffects: [
          expect.objectContaining({ nodeId: "inspect" }),
          expect.objectContaining({ nodeId: "report", writeCount: 1 }),
        ],
      }),
    );

    const experiment = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
        confirmSideEffects: true,
      },
    });
    expect(experiment.result).toEqual(
      expect.objectContaining({
        status: "paused",
        breakpoint: expect.objectContaining({
          nodeId: "report",
          breakpointIndex: 0,
          breakpointCount: 1,
        }),
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            status: "completed",
          }),
        ],
      }),
    );
    const forged = structuredClone(experiment);
    if (forged.preview.schemaVersion !== 5) {
      throw new Error("Expected a step-control preview");
    }
    const { previewSha256: _previewSha256, ...forgedPreviewContent } =
      forged.preview;
    forgedPreviewContent.stopBeforeNodeIds = [];
    forged.preview = {
      ...forgedPreviewContent,
      previewSha256: sha256(canonicalJson(forgedPreviewContent)),
    };
    expect(() => validateExecutionPlanWorkflowExperimentResult(forged)).toThrow(
      "node sets are invalid",
    );
    const pausedEvents = await fixture.store.listEvents(
      experiment.targetThreadId,
    );
    expect(
      pausedEvents.find((event) => event.type === "workflow.experiment.started")
        ?.payload,
    ).toEqual(
      expect.objectContaining({
        executionMode: "step_nodes",
        executionNodeIds: ["inspect"],
        stopBeforeNodeIds: ["report"],
      }),
    );

    fixture.primary.setResponses([
      fauxAssistantMessage(
        '{"report":"Continued step control","approved":true}',
      ),
    ]);
    const completed = await fixture.workflows.run({
      threadId: experiment.targetThreadId,
      request: {
        manifest: experiment.candidateManifest,
        planId: experiment.result.planId,
        continueBreakpoint: true,
      },
    });
    expect(completed).toEqual(
      expect.objectContaining({
        status: "completed",
        output: {
          report: "Continued step control",
          approved: true,
        },
      }),
    );
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(
          fixture.store,
          experiment.targetThreadId,
        ),
      ).status,
    ).toBe("valid");
    fixture.store.close();
  });

  it("simulates one checkpoint output and executes its descendants through the normal scheduler", async () => {
    const fixture = await createFixture();
    const sourceReportRunId = fixture.sourceResult.nodeResults[1]!.runId!;
    for (const type of ["tool.started", "tool.completed"]) {
      await fixture.store.appendEvent({
        threadId: fixture.sourceThreadId,
        runId: sourceReportRunId,
        type,
        category: "tool",
        visibility: "user",
        payload: {
          callId: "call_simulation_descendant_write",
          toolName: "apply_patch",
          status: type === "tool.started" ? "started" : "completed",
          effect: "write",
        },
      });
    }
    const sourceAgentId = fixture.store.getThread(
      fixture.sourceThreadId,
    ).agentId;
    const simulatedOutput = {
      summary: sourceAgentId,
      count: 7,
    };
    const request = {
      ...experimentRequest(fixture),
      fromNodeId: "inspect",
      mode: "simulate_node" as const,
      simulatedOutput,
    };
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      request,
    );
    const encodedOutput = canonicalJson(simulatedOutput);
    expect(preview).toEqual(
      expect.objectContaining({
        schemaVersion: 3,
        mode: "simulate_node",
        reusedNodeIds: [],
        rerunNodeIds: ["inspect", "report"],
        executionNodeIds: ["report"],
        simulatedNodeId: "inspect",
        simulatedOutputSha256: sha256(encodedOutput),
        simulatedOutputBytes: Buffer.byteLength(encodedOutput, "utf8"),
        requiresSideEffectConfirmation: true,
        toolEffects: [
          expect.objectContaining({
            nodeId: "report",
            toolCallCount: 1,
            writeCount: 1,
          }),
        ],
      }),
    );
    await expect(
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request,
      }),
    ).rejects.toThrow("preview changed");
    await expect(
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: {
          ...request,
          expectedPreviewSha256: preview.previewSha256,
        },
      }),
    ).rejects.toThrow("requires explicit confirmation");

    fixture.primary.setResponses([
      fauxAssistantMessage(
        '{"report":"Report from simulated inspection","approved":true}',
      ),
    ]);
    const experiment = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
        confirmSideEffects: true,
      },
    });
    expect(experiment.result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: {
          report: "Report from simulated inspection",
          approved: true,
        },
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            status: "completed",
            output: simulatedOutput,
          }),
          expect.objectContaining({
            nodeId: "report",
            status: "completed",
          }),
        ],
      }),
    );
    expect(
      fixture.store.listRuns(experiment.targetThreadId).map((run) => ({
        source: run.source,
        model: run.configuration?.model,
      })),
    ).toEqual([
      {
        source: "workflow_simulation",
        model: { provider: "napier", id: "workflow-simulation" },
      },
      {
        source: "workflow",
        model: { provider: "faux-workflow-primary", id: "faux-1" },
      },
    ]);
    expect(experiment.comparison?.nodes[0]).toEqual(
      expect.objectContaining({
        nodeId: "inspect",
        execution: "simulated",
        target: expect.objectContaining({
          runSources: ["workflow_simulation"],
          toolNames: [],
          metrics: expect.objectContaining({
            modelResponseCount: 0,
            toolCallCount: 0,
          }),
        }),
      }),
    );
    const events = await fixture.store.listEvents(experiment.targetThreadId);
    const requested = events.filter(
      (event) => event.type === "workflow.node.simulation.requested",
    );
    const simulated = events.filter(
      (event) => event.type === "workflow.node.simulated",
    );
    expect(requested).toEqual([
      expect.objectContaining({
        visibility: "hidden",
        payload: expect.objectContaining({
          output: simulatedOutput,
          outputSha256: sha256(encodedOutput),
        }),
      }),
    ]);
    expect(simulated).toEqual([
      expect.objectContaining({
        visibility: "user",
        payload: expect.not.objectContaining({ output: expect.anything() }),
      }),
    ]);
    expect(
      events.some(
        (event) =>
          event.runId === simulated[0]!.runId &&
          event.type === "model.response",
      ),
    ).toBe(false);
    const bundle = await exportThreadReplayBundle(
      fixture.store,
      experiment.targetThreadId,
    );
    expect(verifyThreadReplayBundle(bundle).status).toBe("valid");
    const imported = await fixture.store.importThreadReplayBundle(bundle);
    const importedRequest = (
      await fixture.store.listEvents(imported.thread.id)
    ).find((event) => event.type === "workflow.node.simulation.requested");
    expect(record(importedRequest?.payload)?.["output"]).toEqual(
      simulatedOutput,
    );
    const importedResult = await fixture.workflows.run({
      threadId: imported.thread.id,
      request: {
        manifest: experiment.candidateManifest,
        planId: imported.plans[0]!.id,
      },
    });
    expect(importedResult.output).toEqual(experiment.result.output);

    fixture.store.close();
    const reopened = new LocalStore({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
    });
    await reopened.initialize();
    const models = new ModelRegistry();
    models.registerProvider(fixture.primary.provider);
    const workflows = new ExecutionPlanWorkflowRuntime(
      reopened,
      new AgentRuntime(reopened, models),
    );
    const resumed = await workflows.run({
      threadId: experiment.targetThreadId,
      request: {
        manifest: experiment.candidateManifest,
        planId: experiment.result.planId,
      },
    });
    expect(resumed).toEqual(
      expect.objectContaining({
        status: "completed",
        output: experiment.result.output,
      }),
    );
    expect(reopened.listRuns(experiment.targetThreadId)).toHaveLength(2);
    reopened.close();
  });

  it("replaces one typed checkpoint input and executes the real descendant subgraph", async () => {
    const fixture = await createFixture({ deterministicInspect: true });
    const sourceAgentId = fixture.store.getThread(
      fixture.sourceThreadId,
    ).agentId;
    const sourceReportRunId = fixture.sourceResult.nodeResults[1]!.runId!;
    for (const type of ["tool.started", "tool.completed"] as const) {
      await fixture.store.appendEvent({
        threadId: fixture.sourceThreadId,
        runId: sourceReportRunId,
        type,
        category: "tool",
        visibility: "user",
        payload: {
          callId: "call_replacement_descendant_write",
          toolName: "apply_patch",
          status: type === "tool.started" ? "started" : "completed",
          effect: "write",
        },
      });
    }
    const replacementInput = {
      workflow: { request: sourceAgentId },
    };
    const encodedInput = canonicalJson(replacementInput);
    const request = {
      ...experimentRequest(fixture),
      fromNodeId: "inspect",
      mode: "replace_input" as const,
      replacementInput,
    };
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      request,
    );
    expect(preview).toEqual(
      expect.objectContaining({
        schemaVersion: 4,
        mode: "replace_input",
        reusedNodeIds: [],
        rerunNodeIds: ["inspect", "report"],
        executionNodeIds: ["inspect", "report"],
        replacedInputNodeId: "inspect",
        replacementInputSha256: sha256(encodedInput),
        replacementInputBytes: Buffer.byteLength(encodedInput, "utf8"),
        requiresSideEffectConfirmation: true,
        toolEffects: [
          expect.objectContaining({ nodeId: "inspect", writeCount: 0 }),
          expect.objectContaining({ nodeId: "report", writeCount: 1 }),
        ],
      }),
    );
    await expect(
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request,
      }),
    ).rejects.toThrow("preview changed");
    await expect(
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: {
          ...request,
          expectedPreviewSha256: preview.previewSha256,
        },
      }),
    ).rejects.toThrow("requires explicit confirmation");

    fixture.primary.setResponses([
      fauxAssistantMessage(
        '{"report":"Report from replaced input","approved":true}',
      ),
    ]);
    const experiment = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...request,
        confirmSideEffects: true,
        expectedPreviewSha256: preview.previewSha256,
      },
    });
    expect(experiment.result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: {
          report: "Report from replaced input",
          approved: true,
        },
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            status: "completed",
            output: { summary: sourceAgentId, count: 1 },
          }),
          expect.objectContaining({
            nodeId: "report",
            status: "completed",
          }),
        ],
      }),
    );
    expect(
      fixture.store
        .listRuns(experiment.targetThreadId)
        .map((run) => run.source),
    ).toEqual(["workflow", "workflow"]);
    expect(experiment.comparison?.nodes[0]).toEqual(
      expect.objectContaining({
        nodeId: "inspect",
        execution: "input_replaced",
        inputChange: "changed",
      }),
    );
    const events = await fixture.store.listEvents(experiment.targetThreadId);
    const requested = events.filter(
      (event) => event.type === "workflow.node.input_replacement.requested",
    );
    expect(requested).toEqual([
      expect.objectContaining({
        visibility: "hidden",
        payload: expect.objectContaining({
          input: replacementInput,
          inputSha256: sha256(encodedInput),
        }),
      }),
    ]);
    expect(
      events.find(
        (event) =>
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "inspect",
      ),
    ).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          inputSha256: sha256(encodedInput),
        }),
      }),
    );

    const bundle = await exportThreadReplayBundle(
      fixture.store,
      experiment.targetThreadId,
    );
    expect(verifyThreadReplayBundle(bundle).status).toBe("valid");
    const imported = await fixture.store.importThreadReplayBundle(bundle);
    const importedRequest = (
      await fixture.store.listEvents(imported.thread.id)
    ).find(
      (event) => event.type === "workflow.node.input_replacement.requested",
    );
    expect(record(importedRequest?.payload)?.["input"]).toEqual(
      replacementInput,
    );
    await expect(
      fixture.workflows.run({
        threadId: imported.thread.id,
        request: {
          manifest: experiment.candidateManifest,
          planId: imported.plans[0]!.id,
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({ output: experiment.result.output }),
    );

    fixture.store.close();
    const reopened = new LocalStore({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
    });
    await reopened.initialize();
    const models = new ModelRegistry();
    models.registerProvider(fixture.primary.provider);
    const workflows = new ExecutionPlanWorkflowRuntime(
      reopened,
      new AgentRuntime(reopened, models),
    );
    await expect(
      workflows.run({
        threadId: experiment.targetThreadId,
        request: {
          manifest: experiment.candidateManifest,
          planId: experiment.result.planId,
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({ output: experiment.result.output }),
    );
    reopened.close();
  });

  it("replaces the top-level input and reruns the complete Workflow", async () => {
    const fixture = await createFixture({ deterministicInspect: true });
    const sourcePlanBefore = fixture.store.getPlan(fixture.sourceResult.planId);
    const sourceReportRunId = fixture.sourceResult.nodeResults[1]!.runId!;
    for (const type of ["tool.started", "tool.completed"] as const) {
      await fixture.store.appendEvent({
        threadId: fixture.sourceThreadId,
        runId: sourceReportRunId,
        type,
        category: "tool",
        visibility: "user",
        payload: {
          callId: "call_top_level_replacement_write",
          toolName: "apply_patch",
          status: type === "tool.started" ? "started" : "completed",
          effect: "write",
        },
      });
    }
    const replacementWorkflowInput = {
      request: "Produce the report from a replacement Workflow input.",
    };
    const encodedInput = canonicalJson(replacementWorkflowInput);
    const request = {
      manifest: fixture.manifest,
      planId: fixture.sourceResult.planId,
      mode: "replace_workflow_input" as const,
      replacementWorkflowInput,
    };
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      request,
    );
    expect(preview).toEqual(
      expect.objectContaining({
        schemaVersion: 6,
        mode: "replace_workflow_input",
        reusedNodeIds: [],
        rerunNodeIds: ["inspect", "report"],
        executionNodeIds: ["inspect", "report"],
        replacementWorkflowInputSha256: sha256(encodedInput),
        replacementWorkflowInputBytes: Buffer.byteLength(encodedInput, "utf8"),
        requiresSideEffectConfirmation: true,
        toolEffects: [
          expect.objectContaining({ nodeId: "inspect", writeCount: 0 }),
          expect.objectContaining({ nodeId: "report", writeCount: 1 }),
        ],
      }),
    );
    expect("fromNodeId" in preview).toBe(false);
    await expect(
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request,
      }),
    ).rejects.toThrow("preview changed");
    await expect(
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: {
          ...request,
          expectedPreviewSha256: preview.previewSha256,
        },
      }),
    ).rejects.toThrow("requires explicit confirmation");

    fixture.primary.setResponses([
      fauxAssistantMessage(
        '{"report":"Top-level replacement report","approved":true}',
      ),
    ]);
    const experiment = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...request,
        confirmSideEffects: true,
        expectedPreviewSha256: preview.previewSha256,
      },
    });
    expect(experiment.result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: {
          report: "Top-level replacement report",
          approved: true,
        },
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            status: "completed",
            output: {
              summary: replacementWorkflowInput.request,
              count: 1,
            },
          }),
          expect.objectContaining({
            nodeId: "report",
            status: "completed",
          }),
        ],
      }),
    );
    expect(
      fixture.store
        .listRuns(experiment.targetThreadId)
        .map((run) => run.source),
    ).toEqual(["workflow", "workflow"]);
    expect(experiment.comparison).toEqual(
      expect.objectContaining({
        sourceInputSha256: expect.not.stringMatching(sha256(encodedInput)),
        targetInputSha256: sha256(encodedInput),
        inputChange: "changed",
        reusedNodeCount: 0,
        rerunNodeCount: 2,
        changedNodeIds: ["inspect", "report"],
      }),
    );
    expect(experiment.comparison?.nodes).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        execution: "rerun",
        inputChange: "changed",
        outputChange: "changed",
      }),
      expect.objectContaining({
        nodeId: "report",
        execution: "rerun",
        inputChange: "changed",
        outputChange: "changed",
      }),
    ]);
    const events = await fixture.store.listEvents(experiment.targetThreadId);
    expect(events.find((event) => event.type === "workflow.started")).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          input: replacementWorkflowInput,
          inputSha256: sha256(encodedInput),
        }),
      }),
    );
    expect(
      events.find((event) => event.type === "workflow.experiment.started"),
    ).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          executionMode: "replace_workflow_input",
          reusedNodeIds: [],
          rerunNodeIds: ["inspect", "report"],
          executionNodeIds: ["inspect", "report"],
          replacementWorkflowInputSha256: sha256(encodedInput),
          replacementWorkflowInputBytes: Buffer.byteLength(
            encodedInput,
            "utf8",
          ),
        }),
      }),
    );
    expect(
      events.some(
        (event) =>
          event.type === "workflow.node.reused" ||
          event.type === "workflow.node.simulation.requested" ||
          event.type === "workflow.node.input_replacement.requested",
      ),
    ).toBe(false);
    expect(fixture.store.getPlan(fixture.sourceResult.planId)).toEqual(
      sourcePlanBefore,
    );
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(
          fixture.store,
          experiment.targetThreadId,
        ),
      ).status,
    ).toBe("valid");

    fixture.store.close();
    const reopened = new LocalStore({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
    });
    await reopened.initialize();
    const models = new ModelRegistry();
    models.registerProvider(fixture.primary.provider);
    const workflows = new ExecutionPlanWorkflowRuntime(
      reopened,
      new AgentRuntime(reopened, models),
    );
    await expect(
      workflows.run({
        threadId: experiment.targetThreadId,
        request: {
          manifest: experiment.candidateManifest,
          planId: experiment.result.planId,
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({ output: experiment.result.output }),
    );
    expect(reopened.listRuns(experiment.targetThreadId)).toHaveLength(2);
    reopened.close();
  });

  it("rejects invalid and tampered top-level Workflow input replacements", async () => {
    const fixture = await createFixture({ deterministicInspect: true });
    const base = {
      manifest: fixture.manifest,
      planId: fixture.sourceResult.planId,
      mode: "replace_workflow_input" as const,
    };
    await expect(
      fixture.experiments.preview(fixture.sourceThreadId, base),
    ).rejects.toThrow("replacement Workflow input");
    await expect(
      fixture.experiments.preview(fixture.sourceThreadId, {
        ...base,
        fromNodeId: "inspect",
        replacementWorkflowInput: { request: "Invalid selector." },
      }),
    ).rejects.toThrow("source is invalid");
    await expect(
      fixture.experiments.preview(fixture.sourceThreadId, {
        ...base,
        replacementWorkflowInput: { request: "" },
      }),
    ).rejects.toThrow("replacement Workflow input");
    await expect(
      fixture.experiments.preview(fixture.sourceThreadId, {
        ...experimentRequest(fixture),
        replacementWorkflowInput: { request: "Invalid mode." },
      }),
    ).rejects.toThrow("requires replace-workflow-input mode");

    const replacementWorkflowInput = {
      request: "Validate top-level replacement evidence.",
    };
    const request = {
      ...base,
      replacementWorkflowInput,
    };
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      request,
    );
    fixture.primary.setResponses([
      fauxAssistantMessage(
        '{"report":"Replacement evidence report","approved":true}',
      ),
    ]);
    const experiment = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      },
    });

    const illegalSelector = structuredClone(experiment);
    (illegalSelector.preview as unknown as Record<string, unknown>)[
      "fromNodeId"
    ] = "inspect";
    rehashExperimentPreview(illegalSelector);
    expect(() =>
      validateExecutionPlanWorkflowExperimentResult(illegalSelector),
    ).toThrow("preview is invalid");

    const reused = structuredClone(experiment);
    reused.preview.reusedNodeIds = ["inspect"];
    rehashExperimentPreview(reused);
    expect(() => validateExecutionPlanWorkflowExperimentResult(reused)).toThrow(
      "node sets",
    );

    const incomplete = structuredClone(experiment);
    if (incomplete.preview.schemaVersion !== 6) {
      throw new Error("Expected schema-v6 Workflow experiment preview");
    }
    incomplete.preview.rerunNodeIds = ["report"];
    incomplete.preview.executionNodeIds = ["report"];
    incomplete.preview.toolEffects = incomplete.preview.toolEffects.filter(
      (effects) => effects.nodeId === "report",
    );
    rehashExperimentPreview(incomplete);
    expect(() =>
      validateExecutionPlanWorkflowExperimentResult(incomplete),
    ).toThrow("result binding");

    const digestDrift = structuredClone(experiment);
    if (digestDrift.preview.schemaVersion !== 6) {
      throw new Error("Expected schema-v6 Workflow experiment preview");
    }
    digestDrift.preview.replacementWorkflowInputSha256 = "f".repeat(64);
    rehashExperimentPreview(digestDrift);
    expect(() =>
      validateExecutionPlanWorkflowExperimentResult(digestDrift),
    ).toThrow("result binding");

    const originalListEvents = fixture.store.listEvents.bind(fixture.store);
    fixture.store.listEvents = async (threadId) => {
      const events = await originalListEvents(threadId);
      if (threadId !== experiment.targetThreadId) return events;
      return events.map((event) => {
        if (event.type !== "workflow.started") return event;
        const altered = structuredClone(event);
        const payload = record(altered.payload)!;
        const input = { request: "Drifted recovered Workflow input." };
        payload["input"] = input;
        payload["inputSha256"] = sha256(canonicalJson(input));
        return altered;
      });
    };
    await expect(
      fixture.workflows.run({
        threadId: experiment.targetThreadId,
        request: {
          manifest: experiment.candidateManifest,
          planId: experiment.result.planId,
        },
      }),
    ).rejects.toThrow(
      "replacement Workflow input recovery evidence is invalid",
    );

    fixture.store.listEvents = async (threadId) => {
      const events = await originalListEvents(threadId);
      if (threadId !== experiment.targetThreadId) return events;
      return events.map((event) => {
        if (event.type !== "workflow.experiment.started") return event;
        const altered = structuredClone(event);
        const payload = record(altered.payload)!;
        payload["replacementWorkflowInputBytes"] =
          Number(payload["replacementWorkflowInputBytes"]) + 1;
        return altered;
      });
    };
    await expect(
      fixture.workflows.run({
        threadId: experiment.targetThreadId,
        request: {
          manifest: experiment.candidateManifest,
          planId: experiment.result.planId,
        },
      }),
    ).rejects.toThrow(
      "replacement Workflow input recovery evidence is invalid",
    );
    fixture.store.listEvents = originalListEvents;
    fixture.store.close();
  });

  it("contains cancellation and isolates concurrent top-level input replacements", async () => {
    const cancelledFixture = await createFixture({
      deterministicInspect: true,
    });
    const cancelledRequest = {
      manifest: cancelledFixture.manifest,
      planId: cancelledFixture.sourceResult.planId,
      mode: "replace_workflow_input" as const,
      replacementWorkflowInput: {
        request: "Cancel this top-level replacement.",
      },
    };
    const cancelledPreview = await cancelledFixture.experiments.preview(
      cancelledFixture.sourceThreadId,
      cancelledRequest,
    );
    const controller = new AbortController();
    const cancelled = await cancelledFixture.experiments.run({
      sourceThreadId: cancelledFixture.sourceThreadId,
      request: {
        ...cancelledRequest,
        expectedPreviewSha256: cancelledPreview.previewSha256,
      },
      signal: controller.signal,
      onEvent: (event) => {
        if (
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "inspect"
        ) {
          controller.abort();
        }
      },
    });
    expect(cancelled.result.status).toBe("cancelled");
    expect(
      (await cancelledFixture.store.listEvents(cancelled.targetThreadId)).some(
        (event) =>
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "report",
      ),
    ).toBe(false);
    cancelledFixture.primary.setResponses([
      fauxAssistantMessage(
        '{"report":"Recovered top-level report","approved":true}',
      ),
    ]);
    await expect(
      cancelledFixture.workflows.run({
        threadId: cancelled.targetThreadId,
        request: {
          manifest: cancelled.candidateManifest,
          planId: cancelled.result.planId,
          retryBlocked: true,
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "completed",
        output: {
          report: "Recovered top-level report",
          approved: true,
        },
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            output: {
              summary: cancelledRequest.replacementWorkflowInput.request,
              count: 1,
            },
          }),
          expect.objectContaining({ nodeId: "report" }),
        ],
      }),
    );
    cancelledFixture.store.close();

    const concurrentFixture = await createFixture({
      deterministicInspect: true,
    });
    const concurrentRequest = {
      manifest: concurrentFixture.manifest,
      planId: concurrentFixture.sourceResult.planId,
      mode: "replace_workflow_input" as const,
      replacementWorkflowInput: {
        request: "Run isolated top-level replacements.",
      },
    };
    const concurrentPreview = await concurrentFixture.experiments.preview(
      concurrentFixture.sourceThreadId,
      concurrentRequest,
    );
    concurrentFixture.primary.setResponses([
      fauxAssistantMessage(
        '{"report":"Concurrent top-level report","approved":true}',
      ),
      fauxAssistantMessage(
        '{"report":"Concurrent top-level report","approved":true}',
      ),
    ]);
    const [left, right] = await Promise.all([
      concurrentFixture.experiments.run({
        sourceThreadId: concurrentFixture.sourceThreadId,
        request: {
          ...concurrentRequest,
          expectedPreviewSha256: concurrentPreview.previewSha256,
        },
      }),
      concurrentFixture.experiments.run({
        sourceThreadId: concurrentFixture.sourceThreadId,
        request: {
          ...concurrentRequest,
          expectedPreviewSha256: concurrentPreview.previewSha256,
        },
      }),
    ]);
    expect(left.targetThreadId).not.toBe(right.targetThreadId);
    for (const experiment of [left, right]) {
      expect(experiment.result).toEqual(
        expect.objectContaining({
          status: "completed",
          output: {
            report: "Concurrent top-level report",
            approved: true,
          },
        }),
      );
      expect(experiment.preview.reusedNodeIds).toEqual([]);
      expect(
        concurrentFixture.store
          .listRuns(experiment.targetThreadId)
          .map((run) => run.source),
      ).toEqual(["workflow", "workflow"]);
    }
    concurrentFixture.store.close();
  });

  it("fails invalid replacement input, contains cancellation, and isolates concurrent targets", async () => {
    const invalidFixture = await createFixture({ deterministicInspect: true });
    await expect(
      invalidFixture.experiments.preview(invalidFixture.sourceThreadId, {
        ...experimentRequest(invalidFixture),
        fromNodeId: "inspect",
        mode: "replace_input",
        replacementInput: { workflow: { request: "" } },
      }),
    ).rejects.toThrow("replacement input");
    expect(invalidFixture.store.listThreads()).toHaveLength(2);
    invalidFixture.store.close();

    const cancelledFixture = await createFixture({
      deterministicInspect: true,
    });
    const cancelledRequest = {
      ...experimentRequest(cancelledFixture),
      fromNodeId: "inspect",
      mode: "replace_input" as const,
      replacementInput: {
        workflow: { request: "Cancel replacement execution" },
      },
    };
    const cancelledPreview = await cancelledFixture.experiments.preview(
      cancelledFixture.sourceThreadId,
      cancelledRequest,
    );
    const controller = new AbortController();
    const cancelled = await cancelledFixture.experiments.run({
      sourceThreadId: cancelledFixture.sourceThreadId,
      request: {
        ...cancelledRequest,
        expectedPreviewSha256: cancelledPreview.previewSha256,
      },
      signal: controller.signal,
      onEvent: (event) => {
        if (
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "inspect"
        ) {
          controller.abort();
        }
      },
    });
    expect(cancelled.result.status).toBe("cancelled");
    expect(
      (await cancelledFixture.store.listEvents(cancelled.targetThreadId)).some(
        (event) =>
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "report",
      ),
    ).toBe(false);
    cancelledFixture.store.close();

    const concurrentFixture = await createFixture({
      deterministicInspect: true,
    });
    const concurrentRequest = {
      ...experimentRequest(concurrentFixture),
      fromNodeId: "inspect",
      mode: "replace_input" as const,
      replacementInput: {
        workflow: { request: "Concurrent replacement input" },
      },
    };
    const concurrentPreview = await concurrentFixture.experiments.preview(
      concurrentFixture.sourceThreadId,
      concurrentRequest,
    );
    concurrentFixture.primary.setResponses([
      fauxAssistantMessage(
        '{"report":"Concurrent replacement report","approved":true}',
      ),
      fauxAssistantMessage(
        '{"report":"Concurrent replacement report","approved":true}',
      ),
    ]);
    const [left, right] = await Promise.all([
      concurrentFixture.experiments.run({
        sourceThreadId: concurrentFixture.sourceThreadId,
        request: {
          ...concurrentRequest,
          expectedPreviewSha256: concurrentPreview.previewSha256,
        },
      }),
      concurrentFixture.experiments.run({
        sourceThreadId: concurrentFixture.sourceThreadId,
        request: {
          ...concurrentRequest,
          expectedPreviewSha256: concurrentPreview.previewSha256,
        },
      }),
    ]);
    expect(left.targetThreadId).not.toBe(right.targetThreadId);
    for (const experiment of [left, right]) {
      expect(experiment.result.output).toEqual({
        report: "Concurrent replacement report",
        approved: true,
      });
    }
    const duplicate = (
      await concurrentFixture.store.listEvents(left.targetThreadId)
    ).find(
      (event) => event.type === "workflow.node.input_replacement.requested",
    )!;
    await concurrentFixture.store.appendEvent({
      threadId: left.targetThreadId,
      runId: "runctl_duplicate_input_replacement",
      type: duplicate.type,
      category: duplicate.category,
      visibility: duplicate.visibility,
      payload: structuredClone(duplicate.payload),
    });
    await expect(
      concurrentFixture.workflows.run({
        threadId: left.targetThreadId,
        request: {
          manifest: left.candidateManifest,
          planId: left.result.planId,
        },
      }),
    ).rejects.toThrow("replacement input recovery evidence");
    concurrentFixture.store.close();
  });

  it("fails invalid simulation, contains cancellation, and isolates concurrent targets", async () => {
    const invalidFixture = await createFixture();
    await expect(
      invalidFixture.experiments.preview(invalidFixture.sourceThreadId, {
        ...experimentRequest(invalidFixture),
        fromNodeId: "inspect",
        mode: "simulate_node",
        simulatedOutput: {
          summary: "Invalid count",
          count: 99,
        },
      }),
    ).rejects.toThrow("simulated output");
    expect(invalidFixture.store.listThreads()).toHaveLength(2);
    invalidFixture.store.close();

    const cancelledFixture = await createFixture();
    const cancelledRequest = {
      ...experimentRequest(cancelledFixture),
      fromNodeId: "inspect",
      mode: "simulate_node" as const,
      simulatedOutput: {
        summary: "Cancel after simulation",
        count: 3,
      },
    };
    const cancelledPreview = await cancelledFixture.experiments.preview(
      cancelledFixture.sourceThreadId,
      cancelledRequest,
    );
    const controller = new AbortController();
    const cancelled = await cancelledFixture.experiments.run({
      sourceThreadId: cancelledFixture.sourceThreadId,
      request: {
        ...cancelledRequest,
        expectedPreviewSha256: cancelledPreview.previewSha256,
      },
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "workflow.node.simulated") controller.abort();
      },
    });
    expect(cancelled.result.status).toBe("cancelled");
    const cancelledEvents = await cancelledFixture.store.listEvents(
      cancelled.targetThreadId,
    );
    expect(
      cancelledEvents.some(
        (event) =>
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "report",
      ),
    ).toBe(false);
    cancelledFixture.store.close();

    const concurrentFixture = await createFixture();
    const concurrentRequest = {
      ...experimentRequest(concurrentFixture),
      fromNodeId: "report",
      mode: "simulate_node" as const,
      simulatedOutput: {
        report: "Concurrent simulated report",
        approved: true,
      },
    };
    const concurrentPreview = await concurrentFixture.experiments.preview(
      concurrentFixture.sourceThreadId,
      concurrentRequest,
    );
    const [left, right] = await Promise.all([
      concurrentFixture.experiments.run({
        sourceThreadId: concurrentFixture.sourceThreadId,
        request: {
          ...concurrentRequest,
          expectedPreviewSha256: concurrentPreview.previewSha256,
        },
      }),
      concurrentFixture.experiments.run({
        sourceThreadId: concurrentFixture.sourceThreadId,
        request: {
          ...concurrentRequest,
          expectedPreviewSha256: concurrentPreview.previewSha256,
        },
      }),
    ]);
    expect(left.targetThreadId).not.toBe(right.targetThreadId);
    for (const experiment of [left, right]) {
      expect(experiment.result).toEqual(
        expect.objectContaining({
          status: "completed",
          output: {
            report: "Concurrent simulated report",
            approved: true,
          },
        }),
      );
      expect(
        concurrentFixture.store
          .listRuns(experiment.targetThreadId)
          .map((run) => run.source),
      ).toEqual(["workflow_reuse", "workflow_simulation"]);
    }

    const duplicate = (
      await concurrentFixture.store.listEvents(left.targetThreadId)
    ).find((event) => event.type === "workflow.node.simulation.requested")!;
    await concurrentFixture.store.appendEvent({
      threadId: left.targetThreadId,
      runId: "runctl_duplicate_simulation",
      type: duplicate.type,
      category: duplicate.category,
      visibility: duplicate.visibility,
      payload: structuredClone(duplicate.payload),
    });
    await expect(
      concurrentFixture.workflows.run({
        threadId: left.targetThreadId,
        request: {
          manifest: left.candidateManifest,
          planId: left.result.planId,
        },
      }),
    ).rejects.toThrow("recovery evidence");
    concurrentFixture.store.close();
  });

  it("contains single-node failure and cancellation before any descendant work", async () => {
    const failedFixture = await createFixture();
    failedFixture.primary.setResponses([fauxAssistantMessage("not json")]);
    const failedRequest = {
      ...experimentRequest(failedFixture),
      fromNodeId: "inspect",
      mode: "single_node" as const,
    };
    const failedPreview = await failedFixture.experiments.preview(
      failedFixture.sourceThreadId,
      failedRequest,
    );
    const failed = await failedFixture.experiments.run({
      sourceThreadId: failedFixture.sourceThreadId,
      request: {
        ...failedRequest,
        expectedPreviewSha256: failedPreview.previewSha256,
      },
    });
    expect(failed.result).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            status: "blocked",
          }),
        ],
      }),
    );
    expect(
      (await failedFixture.store.listEvents(failed.targetThreadId)).some(
        (event) =>
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "report",
      ),
    ).toBe(false);
    failedFixture.store.close();

    const cancelledFixture = await createFixture();
    cancelledFixture.primary.setResponses([
      fauxAssistantMessage('{"summary":"Cancelled inspection","count":1}'),
    ]);
    const controller = new AbortController();
    const cancelledRequest = {
      ...experimentRequest(cancelledFixture),
      fromNodeId: "inspect",
      mode: "single_node" as const,
    };
    const cancelledPreview = await cancelledFixture.experiments.preview(
      cancelledFixture.sourceThreadId,
      cancelledRequest,
    );
    const cancelled = await cancelledFixture.experiments.run({
      sourceThreadId: cancelledFixture.sourceThreadId,
      request: {
        ...cancelledRequest,
        expectedPreviewSha256: cancelledPreview.previewSha256,
      },
      signal: controller.signal,
      onEvent: (event) => {
        if (
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "inspect"
        ) {
          controller.abort();
        }
      },
    });
    expect(cancelled.result.status).toBe("cancelled");
    const cancelledEvents = await cancelledFixture.store.listEvents(
      cancelled.targetThreadId,
    );
    expect(
      cancelledEvents.some(
        (event) => event.type === "workflow.breakpoint.reached",
      ),
    ).toBe(false);
    expect(
      cancelledEvents.some(
        (event) =>
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "report",
      ),
    ).toBe(false);
    cancelledFixture.store.close();
  });

  it("isolates concurrent single-node target holds", async () => {
    const fixture = await createFixture({ deterministicInspect: true });
    const request = {
      ...experimentRequest(fixture),
      fromNodeId: "inspect",
      mode: "single_node" as const,
    };
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      request,
    );
    const boundRequest = {
      ...request,
      expectedPreviewSha256: preview.previewSha256,
    };
    const [left, right] = await Promise.all([
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: boundRequest,
      }),
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: boundRequest,
      }),
    ]);
    expect(left.targetThreadId).not.toBe(right.targetThreadId);
    for (const experiment of [left, right]) {
      expect(experiment.result).toEqual(
        expect.objectContaining({
          status: "paused",
          breakpoint: expect.objectContaining({ nodeId: "report" }),
        }),
      );
      const events = await fixture.store.listEvents(experiment.targetThreadId);
      expect(
        events.filter((event) => event.type === "workflow.breakpoint.reached"),
      ).toHaveLength(1);
      expect(
        events.filter(
          (event) =>
            event.type === "workflow.deterministic.completed" &&
            record(event.payload)?.["nodeId"] === "inspect",
        ),
      ).toHaveLength(1);
    }
    fixture.store.close();
  });

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

  it("reuses a skipped conditional ancestor without manufacturing a Run", async () => {
    const fixture = await createFixture({ conditionalInspect: true });
    expect(fixture.sourceResult.nodeResults[0]).toEqual(
      expect.objectContaining({
        nodeId: "inspect",
        attempt: 0,
        status: "skipped",
        output: { summary: "Source inspection skipped", count: 0 },
      }),
    );
    fixture.alternate.setResponses([
      fauxAssistantMessage(
        '{"report":"Conditional experiment report","approved":true}',
      ),
    ]);
    const experiment = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: experimentRequest(fixture, {
        modelOverrides: {
          report: { provider: "faux-workflow-alternate", id: "faux-1" },
        },
      }),
    });

    expect(experiment.result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: {
          report: "Conditional experiment report",
          approved: true,
        },
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            attempt: 0,
            status: "skipped",
          }),
          expect.objectContaining({
            nodeId: "report",
            status: "completed",
          }),
        ],
      }),
    );
    const targetPlan = fixture.store.getPlan(experiment.result.planId);
    expect(targetPlan.steps[0]?.status).toBe("skipped");
    expect(fixture.store.listRuns(experiment.targetThreadId)).toHaveLength(1);
    const events = await fixture.store.listEvents(experiment.targetThreadId);
    expect(
      events.find((event) => event.type === "workflow.node.reused")?.payload,
    ).toEqual(
      expect.objectContaining({
        nodeId: "inspect",
        sourceStatus: "skipped",
        sourceAttempt: 0,
      }),
    );
    expect(
      events.find((event) => event.type === "workflow.node.skipped")?.payload,
    ).toEqual(
      expect.objectContaining({
        nodeId: "inspect",
        reused: true,
        attempt: 0,
      }),
    );
    expect(experiment.comparison?.nodes[0]).toEqual(
      expect.objectContaining({
        nodeId: "inspect",
        execution: "reused",
        statusChanged: false,
        source: expect.objectContaining({
          status: "skipped",
          runIds: [],
          metrics: expect.objectContaining({
            runCount: 0,
            attemptCount: 0,
          }),
        }),
        target: expect.objectContaining({
          status: "skipped",
          runIds: [],
          metrics: expect.objectContaining({
            runCount: 0,
            attemptCount: 0,
          }),
        }),
      }),
    );
    const forgedSkippedMetrics = structuredClone(experiment.comparison!);
    forgedSkippedMetrics.nodes[0]!.target.metrics.attemptCount = 1;
    expect(() =>
      validateExecutionPlanWorkflowExperimentComparison(
        rehashComparison(forgedSkippedMetrics),
      ),
    ).toThrow("skipped node observation");
    const forgedSkippedStatus = structuredClone(experiment);
    forgedSkippedStatus.comparison!.nodes[0]!.target.status = "completed";
    forgedSkippedStatus.comparison!.nodes[0]!.statusChanged = true;
    forgedSkippedStatus.comparison!.changedNodeIds = [
      "inspect",
      ...forgedSkippedStatus.comparison!.changedNodeIds,
    ];
    forgedSkippedStatus.comparison = rehashComparison(
      forgedSkippedStatus.comparison!,
    );
    expect(() =>
      validateExecutionPlanWorkflowExperimentResult(forgedSkippedStatus),
    ).toThrow("comparison node binding");
    expect(validateExecutionPlanWorkflowExperimentResult(experiment)).toEqual(
      experiment,
    );

    fixture.alternate.setResponses([
      fauxAssistantMessage(
        '{"report":"Conditional checkpoint rerun","approved":true}',
      ),
    ]);
    const rerun = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        manifest: fixture.manifest,
        planId: fixture.sourceResult.planId,
        fromNodeId: "inspect",
        modelOverrides: {
          report: { provider: "faux-workflow-alternate", id: "faux-1" },
        },
      },
    });
    expect(rerun.result.nodeResults[0]).toEqual(
      expect.objectContaining({
        nodeId: "inspect",
        attempt: 0,
        status: "skipped",
      }),
    );
    expect(fixture.store.listRuns(rerun.targetThreadId)).toHaveLength(1);
    expect(rerun.comparison?.nodes[0]).toEqual(
      expect.objectContaining({
        nodeId: "inspect",
        execution: "rerun",
        statusChanged: false,
        target: expect.objectContaining({
          status: "skipped",
          runIds: [],
        }),
      }),
    );
    fixture.store.close();
  });

  it("repairs skipped reuse lineage after a target commit gap", async () => {
    const fixture = await createFixture({ conditionalInspect: true });
    fixture.primary.setResponses([
      fauxAssistantMessage(
        '{"report":"Recovered skipped reuse","approved":true}',
      ),
    ]);
    const appendEvent = fixture.store.appendEvent.bind(fixture.store);
    let failReuse = true;
    fixture.store.appendEvent = async (input) => {
      if (
        input.type === "workflow.node.reused" &&
        record(input.payload)?.["sourceStatus"] === "skipped" &&
        failReuse
      ) {
        failReuse = false;
        throw new Error("Injected skipped reuse lineage failure");
      }
      return appendEvent(input);
    };
    let targetThreadId = "";
    await expect(
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: experimentRequest(fixture),
        onTargetCreated: (thread) => {
          targetThreadId = thread.id;
        },
      }),
    ).rejects.toThrow("skipped reuse lineage");
    const targetPlan = fixture.store.listPlans(targetThreadId)[0]!;
    expect(targetPlan.steps[0]?.status).toBe("skipped");
    expect(
      (await fixture.store.listEvents(targetThreadId)).filter(
        (event) => event.type === "workflow.node.reused",
      ),
    ).toHaveLength(0);

    fixture.store.appendEvent = appendEvent;
    const recovered = await fixture.workflows.run({
      threadId: targetThreadId,
      request: {
        manifest: fixture.manifest,
        planId: targetPlan.id,
      },
    });
    expect(recovered).toEqual(
      expect.objectContaining({
        status: "completed",
        output: {
          report: "Recovered skipped reuse",
          approved: true,
        },
      }),
    );
    const events = await fixture.store.listEvents(targetThreadId);
    expect(
      events.filter((event) => event.type === "workflow.node.skipped"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "workflow.node.reused"),
    ).toHaveLength(1);
    expect(
      events.find((event) => event.type === "workflow.node.skipped")?.payload,
    ).toEqual(expect.objectContaining({ reused: true }));
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
  workspaceRoot: string;
  dataRoot: string;
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
    conditionalInspect?: boolean;
  } = {},
): Promise<Fixture> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-workflow-experiment-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({
    workspaceRoot,
    dataRoot,
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
  const workflowInputSchema = options.conditionalInspect
    ? conditionalRequestSchema()
    : requestSchema();
  const manifest = defineExecutionPlanWorkflow({
    name: "Experiment report",
    version: 1,
    description: "Exercise controlled Workflow checkpoint reruns.",
    blueprint,
    inputSchema: workflowInputSchema,
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
                    properties: { workflow: workflowInputSchema },
                    required: ["workflow"],
                    additionalProperties: false as const,
                  },
                  outputSchema: inspectionSchema(),
                  ...(options.conditionalInspect
                    ? {
                        when: {
                          path: ["workflow", "executeInspect"],
                          equals: true,
                        },
                        skipOutput: {
                          summary: "Source inspection skipped",
                          count: 0,
                        },
                      }
                    : {}),
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
            workflow: workflowInputSchema,
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
      options.deterministicInspect ||
      options.conditionalInspect
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
      input: {
        request: "Produce the source report.",
        ...(options.conditionalInspect ? { executeInspect: false } : {}),
      },
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
    workspaceRoot,
    dataRoot,
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

function rehashExperimentPreview(
  experiment: ExecutionPlanWorkflowExperimentResult,
): void {
  const { previewSha256: _previewSha256, ...content } = experiment.preview;
  experiment.preview.previewSha256 = sha256(canonicalJson(content));
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

function conditionalRequestSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      request: { type: "string", minLength: 1, maxLength: 500 },
      executeInspect: { type: "boolean" },
    },
    required: ["request", "executeInspect"],
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
