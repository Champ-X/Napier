import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type {
  ExecutionPlanWorkflowManifest,
  WorkflowObjectSchema,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { exportThreadReplayBundle, hashEventStream } from "../src/replay.js";
import { streamSnapshotFrame } from "../src/run-stream.js";
import { LocalStore } from "../src/store.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";
import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";
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
        result: expect.objectContaining({
          status: "completed",
          output: { report: "Experimental report", approved: true },
        }),
      }),
    );
    expect(validateExecutionPlanWorkflowExperimentResult(experiment)).toEqual(
      experiment,
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

async function createFixture(): Promise<Fixture> {
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
    nodes: [
      {
        id: "inspect",
        type: "agent",
        inputBindings: { workflow: { source: "workflow" } },
        inputSchema: {
          type: "object",
          properties: { workflow: requestSchema() },
          required: ["workflow"],
          additionalProperties: false,
        },
        outputSchema: inspectionSchema(),
        model: { provider: "faux-workflow-primary", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
      {
        id: "report",
        type: "agent",
        inputBindings: {
          workflow: { source: "workflow" },
          inspection: { source: "node", nodeId: "inspect" },
        },
        inputSchema: {
          type: "object",
          properties: {
            workflow: requestSchema(),
            inspection: inspectionSchema(),
          },
          required: ["workflow", "inspection"],
          additionalProperties: false,
        },
        outputSchema: reportSchema(),
        model: { provider: "faux-workflow-primary", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  });
  primary.setResponses([
    fauxAssistantMessage('{"summary":"Source inspection","count":1}'),
    fauxAssistantMessage('{"report":"Source report","approved":true}'),
  ]);
  const sourceResult = await workflows.run({
    threadId: sourceThread.id,
    request: {
      manifest,
      input: { request: "Produce the source report." },
    },
  });
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

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
