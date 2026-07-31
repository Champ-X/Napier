import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type {
  ExecutionPlanBlueprint,
  ExecutionPlanWorkflowManifest,
  RunEvent,
  WorkflowArraySchema,
  WorkflowObjectSchema,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { LocalStore } from "../src/store.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";
import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";
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

describe("Deterministic Workflow Reduce", () => {
  it("reduces real ordered Map outputs, resumes, and reruns from a checkpoint", async () => {
    const fixture = await createFixture();
    fixture.provider.setResponses([
      fauxAssistantMessage('{"score":2,"accepted":true}'),
      fauxAssistantMessage('{"score":3,"accepted":true}'),
      fauxAssistantMessage('{"score":4,"accepted":false}'),
    ]);
    const manifest = mapReduceManifest(fixture.blueprint);
    const streamed: RunEvent[] = [];

    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { documents: documents() },
      },
      onEvent: (event) => {
        streamed.push(event);
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: 9,
        nodeResults: [
          expect.objectContaining({
            nodeId: "score_items",
            status: "completed",
            output: [
              { score: 2, accepted: true },
              { score: 3, accepted: true },
              { score: 4, accepted: false },
            ],
          }),
          expect.objectContaining({
            nodeId: "total_score",
            status: "completed",
            output: 9,
          }),
        ],
      }),
    );
    const reduceRunId = result.nodeResults[1]!.runId!;
    const events = await fixture.store.listEvents(fixture.targetThreadId);
    expect(
      events.filter(
        (event) =>
          event.runId === reduceRunId &&
          (event.type === "model.response" || event.type.startsWith("tool.")),
      ),
    ).toHaveLength(0);
    expect(
      events.find(
        (event) =>
          event.runId === reduceRunId &&
          event.type === "workflow.reduce.completed",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        operation: "sum",
        itemCount: 3,
        reduceConfigurationSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        itemSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        valueSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(
      JSON.stringify(
        events.filter(
          (event) =>
            event.type === "workflow.reduce.completed" ||
            (event.type.startsWith("workflow.node.") &&
              record(event.payload)?.["nodeId"] === "total_score"),
        ),
      ),
    ).not.toContain("PRIVATE_DOCUMENT");
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, fixture.targetThreadId),
      ).status,
    ).toBe("valid");

    const runCount = fixture.store.listRuns(fixture.targetThreadId).length;
    const resumed = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: { manifest, planId: result.planId },
    });
    expect(resumed).toEqual(
      expect.objectContaining({
        status: "completed",
        resumed: true,
        output: 9,
      }),
    );
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(
      runCount,
    );

    const preview = await fixture.experiments.preview(fixture.targetThreadId, {
      manifest,
      planId: result.planId,
      fromNodeId: "total_score",
    });
    expect(preview).toEqual(
      expect.objectContaining({
        reusedNodeIds: ["score_items"],
        rerunNodeIds: ["total_score"],
        requiresSideEffectConfirmation: false,
      }),
    );
    const experiment = await fixture.experiments.run({
      sourceThreadId: fixture.targetThreadId,
      request: {
        manifest,
        planId: result.planId,
        fromNodeId: "total_score",
        expectedPreviewSha256: preview.previewSha256,
      },
    });
    expect(experiment.result).toEqual(
      expect.objectContaining({ status: "completed", output: 9 }),
    );
    expect(experiment.comparison).toEqual(
      expect.objectContaining({
        reusedNodeCount: 1,
        rerunNodeCount: 1,
        outputChange: "unchanged",
      }),
    );
    expect(
      fixture.store
        .listRuns(experiment.targetThreadId)
        .map((run) => run.source),
    ).toEqual(["workflow_reuse", "workflow"]);
    expect(streamed.map((event) => event.seq)).toEqual(
      [...streamed]
        .map((event) => event.seq)
        .sort((left, right) => left - right),
    );
    fixture.store.close();
  }, 20_000);

  it("runs independent Reduce nodes in one outer wave before a typed join", async () => {
    const fixture = await createFixture();
    const sourceThread = fixture.store.listThreads()[0]!;
    const blueprintThread = await fixture.store.createThread({
      title: "Parallel Reduce Blueprint",
      agentId: sourceThread.agentId,
    });
    const plan = await fixture.store.createPlan(blueprintThread.id, {
      objective: "Run two deterministic reductions before one typed join.",
      steps: [
        {
          id: "sum",
          title: "Sum values",
          description: "Sum every integer.",
          verification: "Return the deterministic sum.",
        },
        {
          id: "maximum",
          title: "Find maximum",
          description: "Find the maximum integer.",
          verification: "Return the deterministic maximum.",
        },
        {
          id: "join",
          title: "Join reductions",
          description: "Join both deterministic outputs.",
          verification: "Return the typed aggregate.",
          dependsOn: ["sum", "maximum"],
        },
      ],
    });
    const blueprint = await createExecutionPlanBlueprint(
      fixture.store,
      blueprintThread.id,
      plan.id,
    );
    const valuesSchema = {
      type: "array" as const,
      items: { type: "integer" as const },
      minItems: 1,
      maxItems: 16,
    };
    const inputSchema = {
      type: "object" as const,
      properties: { values: valuesSchema },
      required: ["values"],
      additionalProperties: false as const,
    };
    const outputSchema = {
      type: "object" as const,
      properties: {
        sum: { type: "integer" as const },
        maximum: { type: "integer" as const },
      },
      required: ["sum", "maximum"],
      additionalProperties: false as const,
    };
    const reduceNode = (id: "sum" | "maximum") => ({
      id,
      type: "reduce" as const,
      inputBindings: {
        values: { source: "workflow" as const, path: ["values"] },
      },
      inputSchema,
      outputSchema: { type: "integer" as const },
      itemsPath: ["values"],
      operation: id === "sum" ? ("sum" as const) : ("maximum" as const),
      timeoutMs: 5_000,
      maxAttempts: 2,
    });
    const manifest = defineExecutionPlanWorkflow({
      name: "Parallel deterministic Reduce",
      version: 1,
      description: "Execute two Reduce nodes before a typed join.",
      blueprint,
      inputSchema,
      outputSchema,
      outputNodeId: "join",
      maxConcurrency: 2,
      nodes: [
        reduceNode("sum"),
        reduceNode("maximum"),
        {
          id: "join",
          type: "deterministic",
          inputBindings: {
            sum: { source: "node", nodeId: "sum" },
            maximum: { source: "node", nodeId: "maximum" },
          },
          inputSchema: outputSchema,
          outputSchema,
          template: {
            kind: "object",
            properties: {
              sum: { kind: "input", path: ["sum"] },
              maximum: { kind: "input", path: ["maximum"] },
            },
          },
          timeoutMs: 5_000,
          maxAttempts: 2,
        },
      ],
    });
    const streamed: RunEvent[] = [];
    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: { manifest, input: { values: [2, 9, 4] } },
      onEvent: (event) => {
        streamed.push(event);
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { sum: 15, maximum: 9 },
      }),
    );
    const starts = streamed.filter(
      (event) =>
        event.type === "workflow.node.started" &&
        ["sum", "maximum"].includes(String(record(event.payload)?.["nodeId"])),
    );
    const completions = streamed.filter(
      (event) =>
        event.type === "workflow.node.completed" &&
        ["sum", "maximum"].includes(String(record(event.payload)?.["nodeId"])),
    );
    expect(starts).toHaveLength(2);
    expect(completions).toHaveLength(2);
    expect(Math.max(...starts.map((event) => event.seq))).toBeLessThan(
      Math.min(...completions.map((event) => event.seq)),
    );
    fixture.store.close();
  });

  it("rejects invalid contracts and fails closed on arithmetic overflow", async () => {
    const fixture = await createFixture();
    const valid = mapReduceManifest(fixture.blueprint);
    expect(() =>
      defineExecutionPlanWorkflow({
        ...manifestDefinition(valid),
        nodes: valid.nodes.map((node) =>
          node.type === "reduce"
            ? { ...node, operation: "count" as const, valuePath: ["score"] }
            : node,
        ),
      }),
    ).toThrow("count Reduce cannot select a value path");
    expect(() =>
      defineExecutionPlanWorkflow({
        ...manifestDefinition(valid),
        nodes: valid.nodes.map((node) =>
          node.type === "reduce"
            ? {
                ...node,
                operation: "minimum" as const,
                inputSchema: {
                  ...node.inputSchema,
                  properties: {
                    items: {
                      ...scoreArraySchema(),
                      minItems: 0,
                    },
                  },
                },
              }
            : node,
        ),
      }),
    ).toThrow("numeric Reduce Schema is invalid");
    expect(() =>
      defineExecutionPlanWorkflow({
        ...manifestDefinition(valid),
        nodes: valid.nodes.map((node) =>
          node.type === "reduce"
            ? { ...node, outputSchema: { type: "boolean" as const } }
            : node,
        ),
        outputSchema: { type: "boolean" },
      }),
    ).toThrow("numeric Reduce Schema is invalid");

    fixture.provider.setResponses([
      fauxAssistantMessage(
        `{"score":${String(Number.MAX_SAFE_INTEGER)},"accepted":true}`,
      ),
      fauxAssistantMessage('{"score":1,"accepted":true}'),
      fauxAssistantMessage('{"score":0,"accepted":true}'),
    ]);
    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: valid,
        input: { documents: documents() },
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            nodeId: "score_items",
            status: "completed",
          }),
          expect.objectContaining({
            nodeId: "total_score",
            status: "blocked",
            errorCode: "arithmetic_overflow",
          }),
        ],
      }),
    );
    const retried = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: valid,
        planId: result.planId,
        retryBlocked: true,
      },
    });
    expect(retried.nodeResults[1]).toEqual(
      expect.objectContaining({
        attempt: 2,
        status: "blocked",
        errorCode: "arithmetic_overflow",
      }),
    );
    fixture.store.close();
  });

  it("recovers a proved Reduce output after Plan completion fails", async () => {
    const fixture = await createFixture();
    fixture.provider.setResponses([
      fauxAssistantMessage('{"score":1,"accepted":true}'),
      fauxAssistantMessage('{"score":2,"accepted":true}'),
      fauxAssistantMessage('{"score":3,"accepted":true}'),
    ]);
    const manifest = mapReduceManifest(fixture.blueprint);
    const original = fixture.store.transitionPlanStep.bind(fixture.store);
    let failCompletion = true;
    fixture.store.transitionPlanStep = async (planId, nodeId, request) => {
      if (
        failCompletion &&
        nodeId === "total_score" &&
        request.action === "complete"
      ) {
        failCompletion = false;
        throw new Error("simulated Reduce Plan commit gap");
      }
      return original(planId, nodeId, request);
    };

    const first = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { documents: documents() },
      },
    });
    expect(first).toEqual(
      expect.objectContaining({
        status: "blocked",
      }),
    );
    const runCount = fixture.store.listRuns(fixture.targetThreadId).length;
    fixture.store.transitionPlanStep = original;
    const recovered = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: { manifest, planId: first.planId },
    });

    expect(recovered).toEqual(
      expect.objectContaining({
        status: "completed",
        resumed: true,
        output: 6,
      }),
    );
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(
      runCount,
    );
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).filter(
        (event) => event.type === "workflow.reduce.completed",
      ),
    ).toHaveLength(1);
    fixture.store.close();
  });

  it("cancels before mutation and times out a Reduce before commitment", async () => {
    const cancelledFixture = await createFixture();
    const manifest = mapReduceManifest(cancelledFixture.blueprint);
    const preAborted = new AbortController();
    preAborted.abort();
    const planCount = cancelledFixture.store.listPlans(
      cancelledFixture.targetThreadId,
    ).length;
    await expect(
      cancelledFixture.workflows.run({
        threadId: cancelledFixture.targetThreadId,
        request: { manifest, input: { documents: documents() } },
        signal: preAborted.signal,
      }),
    ).rejects.toThrow("aborted");
    expect(
      cancelledFixture.store.listPlans(cancelledFixture.targetThreadId),
    ).toHaveLength(planCount);
    cancelledFixture.store.close();

    const activeCancelFixture = await createFixture();
    activeCancelFixture.provider.setResponses([
      fauxAssistantMessage('{"score":1,"accepted":true}'),
      fauxAssistantMessage('{"score":2,"accepted":true}'),
      fauxAssistantMessage('{"score":3,"accepted":true}'),
    ]);
    const activeController = new AbortController();
    const activeCancelled = await activeCancelFixture.workflows.run({
      threadId: activeCancelFixture.targetThreadId,
      request: {
        manifest: mapReduceManifest(activeCancelFixture.blueprint),
        input: { documents: documents() },
      },
      signal: activeController.signal,
      onEvent: (event) => {
        if (
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "total_score"
        ) {
          activeController.abort();
        }
      },
    });
    expect(activeCancelled).toEqual(
      expect.objectContaining({
        status: "cancelled",
        nodeResults: [
          expect.objectContaining({ status: "completed" }),
          expect.objectContaining({
            status: "cancelled",
            errorCode: "cancelled",
          }),
        ],
      }),
    );
    activeCancelFixture.store.close();

    const timeoutFixture = await createFixture();
    timeoutFixture.provider.setResponses([
      fauxAssistantMessage('{"score":1,"accepted":true}'),
      fauxAssistantMessage('{"score":2,"accepted":true}'),
      fauxAssistantMessage('{"score":3,"accepted":true}'),
    ]);
    const timeoutManifest = mapReduceManifest(timeoutFixture.blueprint, 1_000);
    const timedOut = await timeoutFixture.workflows.run({
      threadId: timeoutFixture.targetThreadId,
      request: {
        manifest: timeoutManifest,
        input: { documents: documents() },
      },
      onEvent: async (event) => {
        if (
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "total_score"
        ) {
          await new Promise((resolve) => setTimeout(resolve, 1_100));
        }
      },
    });
    expect(timedOut.nodeResults[1]).toEqual(
      expect.objectContaining({
        status: "blocked",
        errorCode: "timeout",
      }),
    );
    timeoutFixture.store.close();
  }, 20_000);
});

interface Fixture {
  store: LocalStore;
  provider: ReturnType<typeof fauxProvider>;
  workflows: ExecutionPlanWorkflowRuntime;
  experiments: ExecutionPlanWorkflowExperimentRuntime;
  blueprint: ExecutionPlanBlueprint;
  targetThreadId: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-workflow-reduce-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot,
  });
  await store.initialize();
  const registry = new ModelRegistry();
  const provider = fauxProvider({ provider: "faux-workflow-reduce" });
  registry.registerProvider(provider.provider);
  const agentRuntime = new AgentRuntime(store, registry);
  const workflows = new ExecutionPlanWorkflowRuntime(store, agentRuntime);
  const experiments = new ExecutionPlanWorkflowExperimentRuntime(
    store,
    workflows,
  );
  const sourceThread = store.listThreads()[0]!;
  const sourcePlan = await store.createPlan(sourceThread.id, {
    objective: "Score documents and deterministically total every score.",
    steps: [
      {
        id: "score_items",
        title: "Score documents",
        description: "Return one typed score per document.",
        verification: "Every document has one integer score.",
      },
      {
        id: "total_score",
        title: "Total scores",
        description: "Sum every typed score without a model.",
        verification: "The result equals the deterministic score sum.",
        dependsOn: ["score_items"],
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    store,
    sourceThread.id,
    sourcePlan.id,
  );
  const target = await store.createThread({
    title: "Workflow Reduce target",
    agentId: sourceThread.agentId,
  });
  return {
    store,
    provider,
    workflows,
    experiments,
    blueprint,
    targetThreadId: target.id,
  };
}

function mapReduceManifest(
  blueprint: ExecutionPlanBlueprint,
  reduceTimeoutMs = 5_000,
): ExecutionPlanWorkflowManifest {
  return defineExecutionPlanWorkflow({
    name: "Map then Reduce",
    version: 1,
    description: "Score bounded documents and total every score.",
    blueprint,
    inputSchema: documentInputSchema(),
    outputSchema: { type: "integer" },
    outputNodeId: "total_score",
    maxConcurrency: 4,
    nodes: [
      {
        id: "score_items",
        type: "map",
        inputBindings: {
          documents: {
            source: "workflow",
            path: ["documents"],
          },
        },
        inputSchema: {
          type: "object",
          properties: { documents: documentArraySchema() },
          required: ["documents"],
          additionalProperties: false,
        },
        outputSchema: scoreArraySchema(),
        itemsPath: ["documents"],
        model: { provider: "faux-workflow-reduce", id: "faux-1" },
        maxConcurrency: 3,
        itemTimeoutMs: 5_000,
        timeoutMs: 15_000,
        maxAttempts: 2,
      },
      {
        id: "total_score",
        type: "reduce",
        inputBindings: {
          items: { source: "node", nodeId: "score_items" },
        },
        inputSchema: {
          type: "object",
          properties: { items: scoreArraySchema() },
          required: ["items"],
          additionalProperties: false,
        },
        outputSchema: { type: "integer" },
        itemsPath: ["items"],
        valuePath: ["score"],
        operation: "sum",
        timeoutMs: reduceTimeoutMs,
        maxAttempts: 2,
      },
    ],
  });
}

function manifestDefinition(manifest: ExecutionPlanWorkflowManifest) {
  return {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    blueprint: manifest.blueprint,
    inputSchema: manifest.inputSchema,
    outputSchema: manifest.outputSchema,
    outputNodeId: manifest.outputNodeId,
    maxConcurrency: manifest.maxConcurrency,
    generatedAt: manifest.generatedAt,
    nodes: manifest.nodes,
  };
}

function documentInputSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: { documents: documentArraySchema() },
    required: ["documents"],
    additionalProperties: false,
  };
}

function documentArraySchema(): WorkflowArraySchema {
  return {
    type: "array",
    items: {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1, maxLength: 40 },
        text: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["id", "text"],
      additionalProperties: false,
    },
    minItems: 1,
    maxItems: 3,
  };
}

function scoreArraySchema(): WorkflowArraySchema {
  return {
    type: "array",
    items: {
      type: "object",
      properties: {
        score: { type: "integer" },
        accepted: { type: "boolean" },
      },
      required: ["score", "accepted"],
      additionalProperties: false,
    },
    minItems: 1,
    maxItems: 3,
  };
}

function documents() {
  return [
    { id: "doc_a", text: "PRIVATE_DOCUMENT_ALPHA" },
    { id: "doc_b", text: "PRIVATE_DOCUMENT_BETA" },
    { id: "doc_c", text: "PRIVATE_DOCUMENT_GAMMA" },
  ];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
