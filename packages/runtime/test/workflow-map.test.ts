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
import { exportThreadReplayBundle } from "../src/replay.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";
import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";
import { ExecutionPlanWorkflowExperimentRuntime } from "../src/workflow-experiments.js";
import { defineExecutionPlanWorkflow } from "../src/workflow-manifests.js";
import { WORKFLOW_NODE_EXECUTION } from "../src/workflow-node-execution.js";
import { validateExecutionPlanWorkflowResult } from "../src/workflow-protocol.js";
import { ExecutionPlanWorkflowRuntime } from "../src/workflow-runtime.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("bounded read-only Agent Map Workflow", () => {
  it("executes three items concurrently, preserves order, and binds child Runs", async () => {
    const fixture = await createFixture();
    fixture.store.expireDueMemories = async () => {
      throw new Error("Restricted Map execution mutated Memory expiry");
    };
    fixture.store.recordMemoryUsage = async () => {
      throw new Error("Restricted Map execution mutated Memory usage");
    };
    const respond = mapResponse({ assertReadOnlyTools: true });
    fixture.provider.setResponses([respond, respond, respond]);
    const started = new Set<number>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let resolveAllStarted!: () => void;
    const allStarted = new Promise<void>((resolve) => {
      resolveAllStarted = resolve;
    });
    const execution = fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: workflowInput(),
      },
      onEvent: async (event) => {
        if (event.type !== "workflow.map.item.started") return;
        const itemIndex = numberField(event, "itemIndex");
        started.add(itemIndex);
        if (started.size === 3) resolveAllStarted();
        await gate;
      },
    });

    await Promise.race([
      allStarted,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Workflow Map items did not overlap")),
          2_000,
        ),
      ),
    ]);
    const active = fixture.store
      .listRuns(fixture.threadId)
      .filter((run) => run.status === "running");
    expect(active).toHaveLength(4);
    const coordinator = active.find((run) => !run.parentRunId)!;
    expect(
      active
        .filter((run) => run.parentRunId)
        .every((run) => run.parentRunId === coordinator.id),
    ).toBe(true);
    release();

    const result = await execution;
    expect(validateExecutionPlanWorkflowResult(result)).toEqual(result);
    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: [
          { id: "doc_a", length: 5 },
          { id: "doc_b", length: 4 },
          { id: "doc_c", length: 5 },
        ],
      }),
    );
    const runs = fixture.store.listRuns(fixture.threadId);
    expect(runs).toHaveLength(4);
    const children = runs.filter((run) => run.parentRunId === coordinator.id);
    expect(children).toHaveLength(3);
    for (const child of children) {
      expect(child.configuration).toEqual(
        expect.objectContaining({
          executionMode: "workflow_map_read_only",
          toolPolicy: "observe",
          enabledSubagents: [],
        }),
      );
      expect(child.configuration?.enabledTools).not.toContain("apply_patch");
      expect(child.status).toBe("completed");
    }
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events.filter((event) => event.type === "workflow.map.item.started"),
    ).toHaveLength(3);
    expect(
      events.filter((event) => event.type === "workflow.map.item.completed"),
    ).toHaveLength(3);
    expect(
      events.filter((event) => event.type === "workflow.map.completed"),
    ).toHaveLength(1);
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, fixture.threadId),
      ).status,
    ).toBe("valid");
    fixture.store.close();
  });

  it("blocks invalid item output and reruns only after explicit retry", async () => {
    const fixture = await createFixture({ maxConcurrency: 1, itemCount: 2 });
    fixture.provider.setResponses([fauxAssistantMessage("not-json")]);

    const blocked = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: workflowInput(2),
      },
    });
    expect(blocked).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            nodeId: "analyze_documents",
            attempt: 1,
            errorCode: "item_output_invalid",
          }),
        ],
      }),
    );
    expect(fixture.store.listRuns(fixture.threadId)).toHaveLength(2);

    const respond = mapResponse();
    fixture.provider.setResponses([respond, respond]);
    const retried = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: blocked.planId,
        retryBlocked: true,
      },
    });
    expect(retried).toEqual(
      expect.objectContaining({
        status: "completed",
        resumed: true,
        nodeResults: [
          expect.objectContaining({
            nodeId: "analyze_documents",
            attempt: 2,
            status: "completed",
          }),
        ],
      }),
    );
    expect(fixture.store.listRuns(fixture.threadId)).toHaveLength(5);
    fixture.store.close();
  });

  it("completes an empty collection without creating child Runs", async () => {
    const fixture = await createFixture();
    const result = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: workflowInput(0),
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: [],
      }),
    );
    expect(fixture.store.listRuns(fixture.threadId)).toHaveLength(1);
    expect(
      (await fixture.store.listEvents(fixture.threadId)).filter(
        (event) => event.type === "workflow.map.item.started",
      ),
    ).toHaveLength(0);
    fixture.store.close();
  });

  it("recovers a committed Map result without rerunning child items", async () => {
    const fixture = await createFixture({ maxConcurrency: 1, itemCount: 1 });
    fixture.provider.setResponses([mapResponse()]);
    const transition = fixture.store.transitionPlanStep.bind(fixture.store);
    let failCompletion = true;
    fixture.store.transitionPlanStep = async (planId, stepId, request) => {
      if (failCompletion && request.action === "complete") {
        failCompletion = false;
        throw new Error("Simulated Plan completion gap");
      }
      return transition(planId, stepId, request);
    };

    const blocked = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: workflowInput(1),
      },
    });
    expect(blocked.status).toBe("blocked");
    expect(
      fixture.store
        .listRuns(fixture.threadId)
        .map((run) => run.status)
        .sort(),
    ).toEqual(["completed", "completed"]);
    fixture.store.transitionPlanStep = transition;

    const recovered = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: blocked.planId,
      },
    });
    expect(recovered).toEqual(
      expect.objectContaining({
        status: "completed",
        resumed: true,
        output: [{ id: "doc_a", length: 5 }],
      }),
    );
    expect(fixture.store.listRuns(fixture.threadId)).toHaveLength(2);
    expect(
      (await fixture.store.listEvents(fixture.threadId)).filter(
        (event) => event.type === "workflow.map.completed",
      ),
    ).toHaveLength(1);
    fixture.store.close();
  });

  it("enforces the per-item deadline before accepting output", async () => {
    const fixture = await createFixture({
      maxConcurrency: 1,
      itemCount: 1,
      itemTimeoutMs: 1_000,
      timeoutMs: 5_000,
    });
    fixture.provider.setResponses([mapResponse()]);
    const result = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: workflowInput(1),
      },
      onEvent: async (event) => {
        if (event.type === "workflow.map.item.started") {
          await new Promise((resolve) => setTimeout(resolve, 1_100));
        }
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            errorCode: "item_timeout",
          }),
        ],
      }),
    );
    expect(
      (await fixture.store.listEvents(fixture.threadId)).some(
        (event) => event.type === "workflow.map.completed",
      ),
    ).toBe(false);
    fixture.store.close();
  });

  it("reconstructs completed Map output after a Store restart", async () => {
    const fixture = await createFixture({ maxConcurrency: 1, itemCount: 1 });
    fixture.provider.setResponses([mapResponse()]);
    const completed = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: workflowInput(1),
      },
    });
    fixture.store.close();

    const reopened = new LocalStore({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
    });
    await reopened.initialize();
    const resumed = await new ExecutionPlanWorkflowRuntime(
      reopened,
      new AgentRuntime(reopened, new ModelRegistry()),
    ).run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: completed.planId,
      },
    });

    expect(resumed).toEqual(
      expect.objectContaining({
        status: "completed",
        resumed: true,
        output: [{ id: "doc_a", length: 5 }],
      }),
    );
    expect(reopened.listRuns(fixture.threadId)).toHaveLength(2);
    reopened.close();
  });

  it("cancels the coordinator and every active item Run", async () => {
    const fixture = await createFixture({ itemCount: 3 });
    const respond = mapResponse();
    fixture.provider.setResponses([respond, respond, respond]);
    const controller = new AbortController();
    const started = new Set<number>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const result = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: workflowInput(),
      },
      signal: controller.signal,
      onEvent: async (event) => {
        if (event.type !== "workflow.map.item.started") return;
        started.add(numberField(event, "itemIndex"));
        if (started.size === 3) {
          controller.abort();
          release();
        }
        await gate;
      },
    });

    expect(result.status).toBe("cancelled");
    expect(result.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "analyze_documents",
        status: "cancelled",
        errorCode: "cancelled",
      }),
    ]);
    expect(
      fixture.store
        .listRuns(fixture.threadId)
        .every((run) => run.status === "cancelled" || run.status === "failed"),
    ).toBe(true);
    fixture.store.close();
  });

  it("rejects unbounded arrays and excessive item concurrency", async () => {
    const fixture = await createFixture();
    const node = fixture.manifest.nodes[0]!;
    const thread = fixture.store.getThread(fixture.threadId);
    await expect(
      fixture.store.createRun({
        threadId: fixture.threadId,
        agentId: thread.agentId,
        executionMode: "workflow_map_read_only",
      }),
    ).rejects.toThrow("active coordinator");
    const ordinaryPlan = await fixture.store.createPlan(fixture.threadId, {
      objective: "Create a non-Map Workflow parent.",
      steps: [
        {
          id: "ordinary",
          title: "Ordinary node",
          description: "Remain an ordinary Workflow Run.",
          verification: "Cannot authorize a Map child.",
        },
      ],
    });
    const ordinaryParent = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: thread.agentId,
      source: "workflow",
      [WORKFLOW_NODE_EXECUTION]: { planId: ordinaryPlan.id },
    });
    await expect(
      fixture.store.createRun({
        threadId: fixture.threadId,
        agentId: thread.agentId,
        source: "workflow",
        executionMode: "workflow_map_read_only",
        parentRunId: ordinaryParent.id,
        [WORKFLOW_NODE_EXECUTION]: { planId: ordinaryPlan.id },
      }),
    ).rejects.toThrow("active coordinator");
    await fixture.store.finishRun(ordinaryParent.id, "failed", {
      error: "Test parent settled",
    });
    expect(() =>
      defineExecutionPlanWorkflow({
        ...definition(fixture.blueprint, {
          maxConcurrency: 3,
          itemCount: 17,
        }),
      }),
    ).toThrow("Map array bounds");
    expect(() =>
      defineExecutionPlanWorkflow({
        ...definition(fixture.blueprint, {
          maxConcurrency: 4,
          itemCount: 3,
        }),
      }),
    ).toThrow("maxConcurrency");
    expect(node.type).toBe("map");
    fixture.store.close();
  });

  it("reruns a Map checkpoint with a replacement model and child metrics", async () => {
    const fixture = await createFixture({ maxConcurrency: 2, itemCount: 2 });
    const respond = mapResponse();
    fixture.provider.setResponses([respond, respond]);
    const source = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: workflowInput(2),
      },
    });
    const preview = await fixture.experiments.preview(fixture.threadId, {
      manifest: fixture.manifest,
      planId: source.planId,
      fromNodeId: "analyze_documents",
      modelOverrides: {
        analyze_documents: {
          provider: "faux-workflow-map-alternate",
          id: "faux-1",
        },
      },
    });
    expect(preview).toEqual(
      expect.objectContaining({
        rerunNodeIds: ["analyze_documents"],
        reusedNodeIds: [],
        requiresSideEffectConfirmation: false,
      }),
    );

    fixture.alternateProvider.setResponses([respond, respond]);
    const experiment = await fixture.experiments.run({
      sourceThreadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: source.planId,
        fromNodeId: "analyze_documents",
        modelOverrides: {
          analyze_documents: {
            provider: "faux-workflow-map-alternate",
            id: "faux-1",
          },
        },
        expectedPreviewSha256: preview.previewSha256,
      },
    });

    expect(
      experiment.result.status,
      JSON.stringify({
        nodeResults: experiment.result.nodeResults,
        runs: fixture.store.listRuns(experiment.targetThreadId),
      }),
    ).toBe("completed");
    expect(experiment.candidateManifest.nodes[0]).toEqual(
      expect.objectContaining({
        type: "map",
        model: { provider: "faux-workflow-map-alternate", id: "faux-1" },
      }),
    );
    expect(experiment.comparison?.nodes[0]).toEqual(
      expect.objectContaining({
        modelChanged: true,
        source: expect.objectContaining({
          runIds: expect.arrayContaining([
            expect.stringMatching(/^run_/u),
            expect.stringMatching(/^run_/u),
            expect.stringMatching(/^run_/u),
          ]),
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
    fixture.store.close();
  });
});

async function createFixture(
  options: {
    maxConcurrency?: number;
    itemCount?: number;
    itemTimeoutMs?: number;
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
  const root = await mkdtemp(path.join(tmpdir(), "napier-workflow-map-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot,
  });
  await store.initialize();
  const sourceThread = store.listThreads()[0]!;
  const sourcePlan = await store.createPlan(sourceThread.id, {
    objective: "Analyze a bounded document collection.",
    steps: [
      {
        id: "analyze_documents",
        title: "Analyze documents",
        description:
          "Extract the document ID and character length for the current item.",
        verification: "Return one typed result for every input document.",
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    store,
    sourceThread.id,
    sourcePlan.id,
  );
  const thread = await store.createThread({
    title: "Workflow Map target",
    agentId: sourceThread.agentId,
  });
  const provider = fauxProvider({ provider: "faux-workflow-map" });
  const alternateProvider = fauxProvider({
    provider: "faux-workflow-map-alternate",
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
        maxConcurrency: options.maxConcurrency ?? 3,
        itemCount: options.itemCount ?? 3,
        itemTimeoutMs: options.itemTimeoutMs,
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
    maxConcurrency: number;
    itemCount: number;
    itemTimeoutMs?: number;
    timeoutMs?: number;
  },
) {
  const documentSchema = {
    type: "object" as const,
    properties: {
      id: { type: "string" as const, minLength: 1, maxLength: 20 },
      text: { type: "string" as const, minLength: 1, maxLength: 200 },
    },
    required: ["id", "text"],
    additionalProperties: false as const,
  };
  const resultSchema = {
    type: "object" as const,
    properties: {
      id: { type: "string" as const, minLength: 1, maxLength: 20 },
      length: { type: "integer" as const, minimum: 0, maximum: 200 },
    },
    required: ["id", "length"],
    additionalProperties: false as const,
  };
  const outputSchema = {
    type: "array" as const,
    items: resultSchema,
    minItems: 0,
    maxItems: options.itemCount,
  };
  return {
    name: "bounded-document-map",
    version: 1,
    description: "Analyze a bounded document collection concurrently.",
    blueprint,
    inputSchema: {
      type: "object" as const,
      properties: {
        documents: {
          type: "array" as const,
          items: documentSchema,
          minItems: 0,
          maxItems: options.itemCount,
        },
        purpose: { type: "string" as const, minLength: 1, maxLength: 100 },
      },
      required: ["documents", "purpose"],
      additionalProperties: false as const,
    },
    outputSchema,
    outputNodeId: "analyze_documents",
    nodes: [
      {
        id: "analyze_documents",
        type: "map" as const,
        inputBindings: {
          documents: { source: "workflow" as const, path: ["documents"] },
          purpose: { source: "workflow" as const, path: ["purpose"] },
        },
        inputSchema: {
          type: "object" as const,
          properties: {
            documents: {
              type: "array" as const,
              items: documentSchema,
              minItems: 0,
              maxItems: options.itemCount,
            },
            purpose: {
              type: "string" as const,
              minLength: 1,
              maxLength: 100,
            },
          },
          required: ["documents", "purpose"],
          additionalProperties: false as const,
        },
        outputSchema,
        itemsPath: ["documents"],
        model: { provider: "faux-workflow-map", id: "faux-1" },
        maxConcurrency: options.maxConcurrency,
        itemTimeoutMs: options.itemTimeoutMs ?? 5_000,
        timeoutMs: options.timeoutMs ?? 15_000,
        maxAttempts: 2,
      },
    ],
    maxConcurrency: 4,
  };
}

function workflowInput(count = 3) {
  return {
    documents: [
      { id: "doc_a", text: "alpha" },
      { id: "doc_b", text: "beta" },
      { id: "doc_c", text: "gamma" },
    ].slice(0, count),
    purpose: "Measure each document.",
  };
}

function mapResponse(options: { assertReadOnlyTools?: boolean } = {}) {
  return (context: {
    messages: unknown[];
    tools?: ReadonlyArray<{ name: string }>;
  }) => {
    if (options.assertReadOnlyTools) {
      const toolNames = context.tools?.map((tool) => tool.name) ?? [];
      expect(toolNames).toContain("read_file");
      expect(toolNames).not.toContain("apply_patch");
      expect(toolNames).not.toContain("verify_workspace");
      expect(toolNames).not.toContain("workspace_process");
      expect(toolNames).not.toContain("delegate_task");
    }
    const prompt = JSON.stringify(context.messages);
    for (const document of workflowInput().documents) {
      if (prompt.includes(document.id)) {
        return fauxAssistantMessage(
          JSON.stringify({ id: document.id, length: document.text.length }),
        );
      }
    }
    throw new Error("Map item prompt did not contain a known document");
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
    throw new Error(`Map event ${field} is invalid`);
  }
  return Number(value);
}
