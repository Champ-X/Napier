import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type {
  ExecutionPlanBlueprint,
  ExecutionPlanWorkflowManifest,
  RunEvent,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { ModelRegistry } from "../src/models.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { LocalStore } from "../src/store.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";
import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";
import { ExecutionPlanWorkflowExperimentRuntime } from "../src/workflow-experiments.js";
import { recoverWorkflowLoopCheckpoint } from "../src/workflow-loop-evidence.js";
import { defineExecutionPlanWorkflow } from "../src/workflow-manifests.js";
import { WORKFLOW_NODE_EXECUTION } from "../src/workflow-node-execution.js";
import { validateExecutionPlanWorkflowResult } from "../src/workflow-protocol.js";
import { ExecutionPlanWorkflowRuntime } from "../src/workflow-runtime.js";

const roots: string[] = [];
const stores: LocalStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("bounded read-only Agent Loop Workflow", () => {
  it("feeds validated output forward until the typed condition matches", async () => {
    const fixture = await createFixture();
    fixture.provider.setResponses([
      loopResponse(1, false, { assertReadOnlyTools: true }),
      loopResponse(2, false),
      loopResponse(3, true),
    ]);

    const result = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: workflowInput(),
      },
    });

    expect(validateExecutionPlanWorkflowResult(result)).toEqual(result);
    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { done: true, iteration: 3, note: "pass-3" },
        nodeResults: [
          expect.objectContaining({
            nodeId: "refine",
            attempt: 1,
            status: "completed",
          }),
        ],
      }),
    );
    const runs = fixture.store.listRuns(fixture.threadId);
    expect(runs).toHaveLength(4);
    const coordinator = runs.find((run) => !run.parentRunId)!;
    const children = runs.filter((run) => run.parentRunId === coordinator.id);
    expect(children).toHaveLength(3);
    for (const child of children) {
      expect(child.configuration).toEqual(
        expect.objectContaining({
          executionMode: "workflow_loop_read_only",
          toolPolicy: "observe",
          enabledSubagents: [],
        }),
      );
      expect(child.configuration?.enabledTools).toContain("read_file");
      expect(child.configuration?.enabledTools).not.toContain("apply_patch");
      expect(child.status).toBe("completed");
    }
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events.filter(
        (event) => event.type === "workflow.loop.iteration.completed",
      ),
    ).toHaveLength(3);
    expect(
      events.filter((event) => event.type === "workflow.loop.completed"),
    ).toHaveLength(1);
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, fixture.threadId),
      ).status,
    ).toBe("valid");
  });

  it("blocks at the hard iteration limit without accepting partial output", async () => {
    const fixture = await createFixture({ maxIterations: 2 });
    fixture.provider.setResponses([
      loopResponse(1, false),
      loopResponse(2, false),
    ]);

    const result = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: workflowInput(),
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            errorCode: "iteration_limit",
            status: "blocked",
          }),
        ],
      }),
    );
    expect(result).not.toHaveProperty("output");
    expect(
      (await fixture.store.listEvents(fixture.threadId)).some(
        (event) => event.type === "workflow.loop.completed",
      ),
    ).toBe(false);
  });

  it("enforces the per-iteration deadline before accepting output", async () => {
    const fixture = await createFixture({
      iterationTimeoutMs: 1_000,
      timeoutMs: 5_000,
    });
    fixture.provider.setResponses([loopResponse(1, true)]);
    const result = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: workflowInput(),
      },
      onEvent: async (event) => {
        if (event.type === "workflow.loop.iteration.started") {
          await new Promise((resolve) => setTimeout(resolve, 1_100));
        }
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            errorCode: "iteration_timeout",
          }),
        ],
      }),
    );
    expect(
      (await fixture.store.listEvents(fixture.threadId)).some(
        (event) => event.type === "workflow.loop.completed",
      ),
    ).toBe(false);
  });

  it("reuses the completed iteration prefix on explicit retry", async () => {
    const fixture = await createFixture();
    fixture.provider.setResponses([
      loopResponse(1, false),
      fauxAssistantMessage("not-json"),
    ]);
    const blocked = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: workflowInput(),
      },
    });
    expect(blocked).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            attempt: 1,
            errorCode: "iteration_output_invalid",
          }),
        ],
      }),
    );

    fixture.provider.setResponses([loopResponse(2, true)]);
    const resumed = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: blocked.planId,
        retryBlocked: true,
      },
    });

    expect(resumed).toEqual(
      expect.objectContaining({
        status: "completed",
        resumed: true,
        output: { done: true, iteration: 2, note: "pass-2" },
        nodeResults: [
          expect.objectContaining({
            attempt: 2,
            status: "completed",
          }),
        ],
      }),
    );
    const events = await fixture.store.listEvents(fixture.threadId);
    const reused = events.filter(
      (event) => event.type === "workflow.loop.checkpoint.reused",
    );
    expect(reused).toHaveLength(1);
    expect(numberField(reused[0]!, "reusedIterationCount")).toBe(1);
    expect(
      events.filter(
        (event) => event.type === "workflow.loop.iteration.started",
      ),
    ).toHaveLength(3);
    expect(fixture.store.listRuns(fixture.threadId)).toHaveLength(5);
  });

  it("persists the completed prefix across an actual Store restart", async () => {
    const fixture = await createFixture();
    fixture.provider.setResponses([
      loopResponse(1, false),
      fauxAssistantMessage("not-json"),
    ]);
    const blocked = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: workflowInput(),
      },
    });
    expect(blocked).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            errorCode: "iteration_output_invalid",
          }),
        ],
      }),
    );
    fixture.store.close();

    const reopened = new LocalStore({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
    });
    stores.push(reopened);
    await reopened.initialize();
    const provider = fauxProvider({ provider: "faux-workflow-loop" });
    provider.setResponses([loopResponse(2, true)]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const resumed = await new ExecutionPlanWorkflowRuntime(
      reopened,
      new AgentRuntime(reopened, models),
    ).run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: blocked.planId,
        retryBlocked: true,
      },
    });

    expect(resumed).toEqual(
      expect.objectContaining({
        status: "completed",
        resumed: true,
        output: { done: true, iteration: 2, note: "pass-2" },
      }),
    );
    const events = await reopened.listEvents(fixture.threadId);
    expect(
      events.filter(
        (event) => event.type === "workflow.loop.iteration.completed",
      ),
    ).toHaveLength(2);
    expect(
      events.filter(
        (event) => event.type === "workflow.loop.checkpoint.reused",
      ),
    ).toHaveLength(1);
    expect(
      reopened
        .listRuns(fixture.threadId)
        .filter(
          (run) =>
            run.configuration?.schemaVersion !== 1 &&
            run.configuration?.executionMode === "workflow_loop_read_only",
        )
        .map((run) => run.status),
    ).toEqual(["completed", "completed", "completed"]);
  });

  it("cancels the coordinator and active iteration together", async () => {
    const fixture = await createFixture();
    fixture.provider.setResponses([loopResponse(1, false)]);
    const controller = new AbortController();
    const result = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: workflowInput(),
      },
      signal: controller.signal,
      onEvent(event) {
        if (event.type === "workflow.loop.iteration.started") {
          controller.abort();
        }
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "cancelled",
        nodeResults: [
          expect.objectContaining({
            status: "cancelled",
            errorCode: "cancelled",
          }),
        ],
      }),
    );
    expect(
      fixture.store
        .listRuns(fixture.threadId)
        .every((run) => run.status === "cancelled" || run.status === "failed"),
    ).toBe(true);
  });

  it("isolates concurrent Loops on different Threads", async () => {
    const fixture = await createFixture({ maxIterations: 2 });
    const secondThread = await fixture.store.createThread({
      title: "Concurrent Loop target",
      agentId: fixture.store.getThread(fixture.threadId).agentId,
    });
    const adaptive = (context: { messages: unknown[] }) => {
      const prompt = JSON.stringify(context.messages);
      const iteration = prompt.includes("Iteration: 2 of at most") ? 2 : 1;
      return fauxAssistantMessage(
        JSON.stringify({
          done: iteration === 2,
          iteration,
          note: `pass-${String(iteration)}`,
        }),
      );
    };
    fixture.provider.setResponses([adaptive, adaptive, adaptive, adaptive]);

    const [left, right] = await Promise.all([
      fixture.workflows.run({
        threadId: fixture.threadId,
        request: { manifest: fixture.manifest, input: workflowInput() },
      }),
      fixture.workflows.run({
        threadId: secondThread.id,
        request: { manifest: fixture.manifest, input: workflowInput() },
      }),
    ]);

    expect(left.status).toBe("completed");
    expect(right.status).toBe("completed");
    expect(left.output).toEqual({ done: true, iteration: 2, note: "pass-2" });
    expect(right.output).toEqual({ done: true, iteration: 2, note: "pass-2" });
    expect(
      fixture.store
        .listRuns(fixture.threadId)
        .every((run) => run.threadId === fixture.threadId),
    ).toBe(true);
    expect(
      fixture.store
        .listRuns(secondThread.id)
        .every((run) => run.threadId === secondThread.id),
    ).toBe(true);
  });

  it("requires an active Loop coordinator for the child execution mode", async () => {
    const fixture = await createFixture();
    const thread = fixture.store.getThread(fixture.threadId);
    const plan = await fixture.store.createPlan(fixture.threadId, {
      objective: "Create a non-Loop parent.",
      steps: [
        {
          id: "ordinary",
          title: "Ordinary",
          description: "Remain a normal Workflow node.",
          verification: "Cannot authorize a Loop child.",
        },
      ],
    });
    await expect(
      fixture.store.createRun({
        threadId: fixture.threadId,
        agentId: thread.agentId,
        source: "workflow",
        executionMode: "workflow_loop_read_only",
        [WORKFLOW_NODE_EXECUTION]: { planId: plan.id },
      }),
    ).rejects.toThrow("active coordinator");
    const parent = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: thread.agentId,
      source: "workflow",
      [WORKFLOW_NODE_EXECUTION]: { planId: plan.id },
    });
    await expect(
      fixture.store.createRun({
        threadId: fixture.threadId,
        agentId: thread.agentId,
        source: "workflow",
        executionMode: "workflow_loop_read_only",
        parentRunId: parent.id,
        [WORKFLOW_NODE_EXECUTION]: { planId: plan.id },
      }),
    ).rejects.toThrow("active coordinator");
    await fixture.store.finishRun(parent.id, "failed", {
      error: "Test parent settled",
    });
  });

  it("reruns a Loop checkpoint with a replacement model and child metrics", async () => {
    const fixture = await createFixture({ maxIterations: 2 });
    fixture.provider.setResponses([
      loopResponse(1, false),
      loopResponse(2, true),
    ]);
    const source = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: workflowInput(),
      },
    });
    const preview = await fixture.experiments.preview(fixture.threadId, {
      manifest: fixture.manifest,
      planId: source.planId,
      fromNodeId: "refine",
      modelOverrides: {
        refine: {
          provider: "faux-workflow-loop-alternate",
          id: "faux-1",
        },
      },
    });
    expect(preview).toEqual(
      expect.objectContaining({
        rerunNodeIds: ["refine"],
        reusedNodeIds: [],
        requiresSideEffectConfirmation: false,
      }),
    );

    fixture.alternateProvider.setResponses([
      loopResponse(1, false),
      loopResponse(2, true),
    ]);
    const experiment = await fixture.experiments.run({
      sourceThreadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: source.planId,
        fromNodeId: "refine",
        modelOverrides: {
          refine: {
            provider: "faux-workflow-loop-alternate",
            id: "faux-1",
          },
        },
        expectedPreviewSha256: preview.previewSha256,
      },
    });

    expect(experiment.result.status).toBe("completed");
    expect(experiment.candidateManifest.nodes[0]).toEqual(
      expect.objectContaining({
        type: "loop",
        model: { provider: "faux-workflow-loop-alternate", id: "faux-1" },
      }),
    );
    expect(experiment.comparison?.nodes[0]).toEqual(
      expect.objectContaining({
        modelChanged: true,
        source: expect.objectContaining({
          metrics: expect.objectContaining({
            runCount: 3,
            attemptCount: 1,
            modelResponseCount: 2,
          }),
        }),
        target: expect.objectContaining({
          metrics: expect.objectContaining({
            runCount: 3,
            attemptCount: 1,
            modelResponseCount: 2,
          }),
        }),
      }),
    );
  });

  it("rejects tampered iteration evidence before checkpoint reuse", async () => {
    const fixture = await createFixture({ maxIterations: 2 });
    fixture.provider.setResponses([
      loopResponse(1, false),
      loopResponse(2, true),
    ]);
    const result = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: { manifest: fixture.manifest, input: workflowInput() },
    });
    expect(result.status).toBe("completed");
    const node = fixture.manifest.nodes[0]!;
    if (node.type !== "loop") throw new Error("Expected Loop node");
    const originalEvents = await fixture.store.listEvents(fixture.threadId);
    const events = structuredClone(originalEvents);
    const completion = events.find(
      (event) => event.type === "workflow.loop.iteration.completed",
    )!;
    if (
      !completion.payload ||
      Array.isArray(completion.payload) ||
      typeof completion.payload !== "object"
    ) {
      throw new Error("Expected Loop completion payload");
    }
    completion.payload["outputSha256"] = "f".repeat(64);
    const coordinator = fixture.store
      .listRuns(fixture.threadId)
      .find((run) => run.id === result.nodeResults[0]?.runId)!;
    expect(() =>
      recoverWorkflowLoopCheckpoint({
        events,
        runs: fixture.store.listRuns(fixture.threadId),
        node,
        planId: result.planId,
        manifestSha256: fixture.manifest.contentSha256,
        nodeInput: workflowInput(),
        nodeInputSha256: sha256(canonicalJson(workflowInput())),
        agentId: coordinator.agentId,
        agentRevision: coordinator.agentRevision!,
        model: coordinator.configuration!.model,
      }),
    ).toThrow("output evidence mismatch");

    const parentTampered = structuredClone(originalEvents);
    const coordinatorStarted = parentTampered.find(
      (event) =>
        event.runId === coordinator.id &&
        event.type === "workflow.node.started",
    )!;
    if (
      !coordinatorStarted.payload ||
      Array.isArray(coordinatorStarted.payload) ||
      typeof coordinatorStarted.payload !== "object"
    ) {
      throw new Error("Expected Loop coordinator payload");
    }
    coordinatorStarted.payload["loopConfigurationSha256"] = "e".repeat(64);
    expect(() =>
      recoverWorkflowLoopCheckpoint({
        events: parentTampered,
        runs: fixture.store.listRuns(fixture.threadId),
        node,
        planId: result.planId,
        manifestSha256: fixture.manifest.contentSha256,
        nodeInput: workflowInput(),
        nodeInputSha256: sha256(canonicalJson(workflowInput())),
        agentId: coordinator.agentId,
        agentRevision: coordinator.agentRevision!,
        model: coordinator.configuration!.model,
      }),
    ).toThrow("iteration evidence is invalid");

    const duplicated = structuredClone(originalEvents);
    const duplicate = structuredClone(
      duplicated.find(
        (event) => event.type === "workflow.loop.iteration.completed",
      )!,
    );
    duplicate.id = "event_loopduplicate12345678";
    duplicate.seq = Math.max(...duplicated.map((event) => event.seq)) + 1;
    duplicated.push(duplicate);
    expect(() =>
      recoverWorkflowLoopCheckpoint({
        events: duplicated,
        runs: fixture.store.listRuns(fixture.threadId),
        node,
        planId: result.planId,
        manifestSha256: fixture.manifest.contentSha256,
        nodeInput: workflowInput(),
        nodeInputSha256: sha256(canonicalJson(workflowInput())),
        agentId: coordinator.agentId,
        agentRevision: coordinator.agentRevision!,
        model: coordinator.configuration!.model,
      }),
    ).toThrow("iteration evidence is invalid");
  });
});

async function createFixture(
  options: {
    maxIterations?: number;
    iterationTimeoutMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<{
  store: LocalStore;
  provider: ReturnType<typeof fauxProvider>;
  alternateProvider: ReturnType<typeof fauxProvider>;
  workflows: ExecutionPlanWorkflowRuntime;
  experiments: ExecutionPlanWorkflowExperimentRuntime;
  threadId: string;
  manifest: ExecutionPlanWorkflowManifest;
  blueprint: ExecutionPlanBlueprint;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-workflow-loop-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  const store = new LocalStore({ workspaceRoot, dataRoot });
  stores.push(store);
  await store.initialize();
  const sourceThread = store.listThreads()[0]!;
  const sourceAgent = store.getAgent(sourceThread.agentId);
  await store.updateAgent(sourceAgent.id, {
    toolPolicy: "workspace",
    enabledTools: ["read_file", "apply_patch", "verify_workspace"],
  });
  const sourcePlan = await store.createPlan(sourceThread.id, {
    objective: "Refine one bounded result until it is ready.",
    steps: [
      {
        id: "refine",
        title: "Refine result",
        description:
          "Review the previous validated result and advance it by one iteration.",
        verification: "Stop only when done is true.",
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    store,
    sourceThread.id,
    sourcePlan.id,
  );
  const thread = await store.createThread({
    title: "Workflow Loop target",
    agentId: sourceThread.agentId,
  });
  const provider = fauxProvider({ provider: "faux-workflow-loop" });
  const alternateProvider = fauxProvider({
    provider: "faux-workflow-loop-alternate",
  });
  const models = new ModelRegistry();
  models.registerProvider(provider.provider);
  models.registerProvider(alternateProvider.provider);
  const agentRuntime = new AgentRuntime(store, models);
  const workflows = new ExecutionPlanWorkflowRuntime(store, agentRuntime);
  return {
    store,
    provider,
    alternateProvider,
    workflows,
    experiments: new ExecutionPlanWorkflowExperimentRuntime(store, workflows),
    threadId: thread.id,
    manifest: defineExecutionPlanWorkflow(
      definition(blueprint, {
        maxIterations: options.maxIterations ?? 3,
        iterationTimeoutMs: options.iterationTimeoutMs,
        timeoutMs: options.timeoutMs,
      }),
    ),
    blueprint,
    workspaceRoot,
    dataRoot,
  };
}

function definition(
  blueprint: ExecutionPlanBlueprint,
  options: {
    maxIterations: number;
    iterationTimeoutMs?: number;
    timeoutMs?: number;
  },
) {
  return {
    name: "bounded-refinement-loop",
    version: 1,
    description: "Refine one typed result through bounded read-only turns.",
    blueprint,
    inputSchema: inputSchema(),
    outputSchema: outputSchema(),
    outputNodeId: "refine",
    nodes: [
      {
        id: "refine",
        type: "loop" as const,
        inputBindings: {
          goal: { source: "workflow" as const, path: ["goal"] },
        },
        inputSchema: {
          type: "object" as const,
          properties: {
            goal: { type: "string" as const, minLength: 1, maxLength: 200 },
          },
          required: ["goal"],
          additionalProperties: false as const,
        },
        outputSchema: outputSchema(),
        until: { path: ["done"], equals: true },
        model: { provider: "faux-workflow-loop", id: "faux-1" },
        maxIterations: options.maxIterations,
        iterationTimeoutMs: options.iterationTimeoutMs ?? 5_000,
        timeoutMs: options.timeoutMs ?? 20_000,
        maxAttempts: 3,
      },
    ],
  };
}

function inputSchema() {
  return {
    type: "object" as const,
    properties: {
      goal: { type: "string" as const, minLength: 1, maxLength: 200 },
    },
    required: ["goal"],
    additionalProperties: false as const,
  };
}

function outputSchema() {
  return {
    type: "object" as const,
    properties: {
      done: { type: "boolean" as const },
      iteration: { type: "integer" as const, minimum: 1, maximum: 8 },
      note: { type: "string" as const, minLength: 1, maxLength: 100 },
    },
    required: ["done", "iteration", "note"],
    additionalProperties: false as const,
  };
}

function workflowInput() {
  return { goal: "Produce a verified bounded result." };
}

function loopResponse(
  iteration: number,
  done: boolean,
  options: { assertReadOnlyTools?: boolean } = {},
) {
  return (context: {
    messages: unknown[];
    tools?: ReadonlyArray<{ name: string }>;
  }) => {
    if (options.assertReadOnlyTools) {
      const toolNames = context.tools?.map((tool) => tool.name) ?? [];
      expect(toolNames).toContain("read_file");
      expect(toolNames).not.toContain("apply_patch");
      expect(toolNames).not.toContain("verify_workspace");
      expect(toolNames).not.toContain("delegate_task");
    }
    const prompt = JSON.stringify(context.messages);
    expect(prompt).toContain(`Iteration: ${String(iteration)} of at most`);
    expect(prompt).toContain("previousOutput");
    if (iteration === 1) {
      expect(prompt).toContain("null");
    } else {
      expect(prompt).toContain(`pass-${String(iteration - 1)}`);
    }
    return fauxAssistantMessage(
      JSON.stringify({ done, iteration, note: `pass-${String(iteration)}` }),
    );
  };
}

function numberField(event: RunEvent, field: string): number {
  const value =
    event.payload &&
    !Array.isArray(event.payload) &&
    typeof event.payload === "object"
      ? event.payload[field]
      : undefined;
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Loop event ${field} is invalid`);
  }
  return Number(value);
}
