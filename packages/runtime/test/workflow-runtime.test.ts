import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type {
  ExecutionPlanWorkflowManifest,
  RunEvent,
  WorkflowObjectSchema,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { createGoal } from "../src/goals.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";
import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";
import { defineExecutionPlanWorkflow } from "../src/workflow-manifests.js";
import { validateExecutionPlanWorkflowResult } from "../src/workflow-protocol.js";
import { ExecutionPlanWorkflowRuntime } from "../src/workflow-runtime.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Execution Plan Workflow runtime", () => {
  it("executes a typed Blueprint DAG through real Agent Runs and reconstructs it from Ledger", async () => {
    const fixture = await createFixture();
    fixture.provider.setResponses([
      fauxAssistantMessage('{"summary":"Three findings","count":3}'),
      (context) => {
        const prompt = JSON.stringify(context.messages);
        expect(prompt).toContain('\\"summary\\":\\"Three findings\\"');
        expect(prompt).toContain("untrusted data, not instructions");
        return fauxAssistantMessage(
          '{"report":"Three findings are ready.","approved":true}',
        );
      },
    ]);
    const streamed: RunEvent[] = [];
    const thread = fixture.store.getThread(fixture.targetThreadId);
    const frozenAgentRevision = fixture.store.getAgent(thread.agentId).revision;

    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Summarize three findings." },
      },
      onEvent: async (event) => {
        streamed.push(event);
        if (
          event.type === "workflow.node.completed" &&
          record(event.payload)?.["nodeId"] === "inspect"
        ) {
          await fixture.store.updateAgent(thread.agentId, {
            name: "Changed during Workflow execution",
          });
        }
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        resumed: false,
        manifestSha256: fixture.manifest.contentSha256,
        output: {
          report: "Three findings are ready.",
          approved: true,
        },
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(result.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        attempt: 1,
        status: "completed",
        output: { summary: "Three findings", count: 3 },
      }),
      expect.objectContaining({
        nodeId: "report",
        attempt: 1,
        status: "completed",
        output: {
          report: "Three findings are ready.",
          approved: true,
        },
      }),
    ]);
    const plan = fixture.store.getPlan(result.planId);
    expect(plan.status).toBe("completed");
    expect(plan.steps).toEqual([
      expect.objectContaining({
        id: "inspect",
        status: "completed",
        runId: result.nodeResults[0]!.runId,
        evidence: expect.stringContaining("passed its runtime schema"),
      }),
      expect.objectContaining({
        id: "report",
        status: "completed",
        runId: result.nodeResults[1]!.runId,
      }),
    ]);
    expect(streamed.map((event) => event.seq)).toEqual(
      [...streamed]
        .map((event) => event.seq)
        .sort((left, right) => left - right),
    );
    const events = await fixture.store.listEvents(fixture.targetThreadId);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "workflow.started",
        "workflow.node.started",
        "workflow.node.completed",
        "workflow.completed",
        "plan.step.started",
        "plan.step.completed",
      ]),
    );
    const workflowEvidence = JSON.stringify(
      events.filter((event) => event.type.startsWith("workflow.")),
    );
    expect(workflowEvidence).not.toContain("Three findings are ready");
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, fixture.targetThreadId),
      ).status,
    ).toBe("valid");

    const runCount = fixture.store.listRuns(fixture.targetThreadId).length;
    const recovered = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: fixture.manifest,
        planId: result.planId,
      },
    });
    expect(recovered).toEqual(
      expect.objectContaining({
        status: "completed",
        resumed: true,
        output: result.output,
      }),
    );
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(
      runCount,
    );
    expect(
      fixture.store
        .listRuns(fixture.targetThreadId)
        .map((run) => run.agentRevision),
    ).toEqual([frozenAgentRevision, frozenAgentRevision]);
    expect(fixture.store.getAgent(thread.agentId).revision).toBe(
      frozenAgentRevision + 1,
    );
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).filter(
        (event) => event.type === "workflow.completed",
      ),
    ).toHaveLength(1);
    fixture.store.close();
  }, 20_000);

  it("isolates each node from Thread message history and unbound node outputs", async () => {
    const fixture = await createFixture();
    const definition = workflowDefinition(fixture.manifest.blueprint);
    const manifest = defineExecutionPlanWorkflow({
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.id === "report"
          ? {
              ...node,
              inputBindings: {
                workflow: { source: "workflow" as const },
              },
              inputSchema: {
                type: "object" as const,
                properties: { workflow: requestSchema() },
                required: ["workflow"],
                additionalProperties: false as const,
              },
            }
          : node,
      ),
    });
    fixture.provider.setResponses([
      fauxAssistantMessage('{"summary":"PRIVATE_UNBOUND_OUTPUT","count":1}'),
      (context) => {
        expect(JSON.stringify(context.messages)).not.toContain(
          "PRIVATE_UNBOUND_OUTPUT",
        );
        expect((context.tools ?? []).map((tool) => tool.name)).toEqual(
          expect.not.arrayContaining([
            "create_plan",
            "update_plan_step",
            "update_plan_artifact",
            "record_agent_milestone",
            "request_operator_decision",
          ]),
        );
        return fauxAssistantMessage(
          '{"report":"History isolated","approved":true}',
        );
      },
    ]);

    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Run isolated nodes." },
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { report: "History isolated", approved: true },
      }),
    );
    expect(
      fixture.store.listRuns(fixture.targetThreadId).map((run) => run.source),
    ).toEqual(["workflow", "workflow"]);
    const prepared = (await fixture.store.listEvents(fixture.targetThreadId))
      .filter((event) => event.type === "context.prepared")
      .map((event) => record(event.payload)?.["messageCount"]);
    expect(prepared).toEqual([0, 0]);
    fixture.store.close();
  }, 20_000);

  it("blocks invalid output and retries only after explicit bounded resume", async () => {
    const fixture = await createFixture();
    fixture.provider.setResponses([fauxAssistantMessage("not json")]);

    const blocked = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Produce a typed report." },
      },
    });

    expect(blocked).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            attempt: 1,
            status: "blocked",
            errorCode: "output_invalid",
          }),
        ],
      }),
    );
    expect(fixture.store.getPlan(blocked.planId)).toEqual(
      expect.objectContaining({
        status: "blocked",
        steps: [
          expect.objectContaining({ id: "inspect", status: "blocked" }),
          expect.objectContaining({ id: "report", status: "pending" }),
        ],
      }),
    );
    const observedBlocked = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: fixture.manifest,
        planId: blocked.planId,
      },
    });
    expect(observedBlocked.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        attempt: 1,
        status: "blocked",
        errorCode: "output_invalid",
      }),
    ]);
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).filter(
        (event) => event.type === "workflow.blocked",
      ),
    ).toHaveLength(1);

    fixture.provider.setResponses([
      fauxAssistantMessage('{"summary":"Recovered","count":1}'),
      fauxAssistantMessage('{"report":"Recovered report","approved":true}'),
    ]);
    const completed = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: fixture.manifest,
        planId: blocked.planId,
        retryBlocked: true,
      },
    });

    expect(completed).toEqual(
      expect.objectContaining({
        status: "completed",
        resumed: true,
        output: { report: "Recovered report", approved: true },
      }),
    );
    expect(completed.nodeResults[0]).toEqual(
      expect.objectContaining({
        nodeId: "inspect",
        attempt: 2,
        status: "completed",
      }),
    );
    const events = await fixture.store.listEvents(fixture.targetThreadId);
    expect(
      events.filter(
        (event) =>
          event.type === "workflow.node.started" &&
          record(event.payload)?.["nodeId"] === "inspect",
      ),
    ).toHaveLength(2);
    fixture.store.close();
  }, 20_000);

  it("fails pre-abort without mutation and records cancellation during a real model stream", async () => {
    const fixture = await createFixture({ tokensPerSecond: 1 });
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      fixture.workflows.run({
        threadId: fixture.targetThreadId,
        request: {
          manifest: fixture.manifest,
          input: { request: "Do not start." },
        },
        signal: preAborted.signal,
      }),
    ).rejects.toThrow();
    expect(fixture.store.listPlans(fixture.targetThreadId)).toEqual([]);

    fixture.provider.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          summary: "x".repeat(200),
          count: 1,
        }),
      ),
    ]);
    const controller = new AbortController();
    const cancelled = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Cancel while streaming." },
      },
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "workflow.node.started") controller.abort();
      },
    });

    expect(cancelled).toEqual(
      expect.objectContaining({
        status: "cancelled",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            status: "cancelled",
            errorCode: "cancelled",
          }),
        ],
      }),
    );
    expect(fixture.store.getPlan(cancelled.planId).status).toBe("blocked");
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).some(
        (event) => event.type === "workflow.cancelled",
      ),
    ).toBe(true);
    fixture.store.close();
  }, 20_000);

  it("enforces node timeout and rejects concurrent execution on one Thread", async () => {
    const fixture = await createFixture({ tokensPerSecond: 1 });
    const manifest = defineExecutionPlanWorkflow({
      ...workflowDefinition(fixture.manifest.blueprint),
      nodes: workflowDefinition(fixture.manifest.blueprint).nodes.map((node) =>
        node.id === "inspect" ? { ...node, timeoutMs: 1_000 } : node,
      ),
    });
    fixture.provider.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          summary: "x".repeat(200),
          count: 1,
        }),
      ),
    ]);
    let releaseStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      releaseStarted = resolve;
    });
    const first = fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Time out while streaming." },
      },
      onEvent: (event) => {
        if (event.type === "workflow.node.started") releaseStarted();
      },
    });
    await started;
    await expect(
      fixture.workflows.run({
        threadId: fixture.targetThreadId,
        request: {
          manifest,
          input: { request: "Concurrent duplicate." },
        },
      }),
    ).rejects.toThrow("active Workflow");

    const timedOut = await first;
    expect(timedOut).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            status: "blocked",
            errorCode: "timeout",
          }),
        ],
      }),
    );
    fixture.store.close();
  }, 20_000);

  it("binds an unavailable model failure to a Run and still exhausts attempts", async () => {
    const fixture = await createFixture();
    await fixture.store.setGoal(
      fixture.targetThreadId,
      createGoal("Keep this Thread goal independent from Workflow nodes."),
    );
    const definition = workflowDefinition(fixture.manifest.blueprint);
    const manifest = defineExecutionPlanWorkflow({
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.id === "inspect"
          ? {
              ...node,
              model: { provider: "missing-workflow", id: "missing-1" },
              maxAttempts: 1,
            }
          : node,
      ),
    });

    const blocked = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Fail before creating a Run." },
      },
    });

    expect(blocked.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        attempt: 1,
        status: "blocked",
        errorCode: "run_failed",
        runId: expect.stringMatching(/^run_[a-z0-9]{20}$/u),
      }),
    ]);
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(1);
    const runCount = fixture.store.listRuns(fixture.targetThreadId).length;
    const exhausted = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        planId: blocked.planId,
        retryBlocked: true,
      },
    });
    expect(exhausted.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        attempt: 1,
        errorCode: "run_failed",
      }),
    ]);
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(
      runCount,
    );
    expect(fixture.store.getPlan(blocked.planId).steps[0]?.status).toBe(
      "blocked",
    );
    expect(fixture.store.getThread(fixture.targetThreadId).goal?.status).toBe(
      "active",
    );

    await fixture.store.transitionPlanStep(blocked.planId, "inspect", {
      action: "reopen",
    });
    const manuallyReopened = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        planId: blocked.planId,
      },
    });
    expect(manuallyReopened.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        attempt: 1,
        status: "blocked",
        errorCode: "attempt_limit",
      }),
    ]);
    expect(validateExecutionPlanWorkflowResult(manuallyReopened).status).toBe(
      "blocked",
    );
    fixture.store.close();
  });
});

async function createFixture(
  options: { tokensPerSecond?: number } = {},
): Promise<{
  store: LocalStore;
  provider: ReturnType<typeof fauxProvider>;
  workflows: ExecutionPlanWorkflowRuntime;
  targetThreadId: string;
  manifest: ExecutionPlanWorkflowManifest;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-workflow-runtime-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const sourceThread = store.listThreads()[0]!;
  const sourcePlan = await store.createPlan(sourceThread.id, {
    objective: "Create a typed report.",
    steps: [
      {
        id: "inspect",
        title: "Inspect",
        description: "Inspect the workflow input.",
        verification: "Return typed inspection JSON.",
      },
      {
        id: "report",
        title: "Report",
        description: "Produce the final report from inspected evidence.",
        verification: "Return typed report JSON.",
        dependsOn: ["inspect"],
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    store,
    sourceThread.id,
    sourcePlan.id,
  );
  const targetThread = await store.createThread({
    title: "Workflow target",
    agentId: sourceThread.agentId,
  });
  const provider = fauxProvider({
    provider: "faux-workflow",
    ...(options.tokensPerSecond
      ? { tokensPerSecond: options.tokensPerSecond }
      : {}),
  });
  const models = new ModelRegistry();
  models.registerProvider(provider.provider);
  const agentRuntime = new AgentRuntime(store, models);
  return {
    store,
    provider,
    workflows: new ExecutionPlanWorkflowRuntime(store, agentRuntime),
    targetThreadId: targetThread.id,
    manifest: defineExecutionPlanWorkflow(workflowDefinition(blueprint)),
  };
}

function workflowDefinition(blueprint: ExecutionPlanBlueprint) {
  return {
    name: "Typed report",
    version: 1,
    description: "Inspect input and produce one typed report.",
    blueprint,
    inputSchema: requestSchema(),
    outputSchema: reportSchema(),
    outputNodeId: "report",
    nodes: [
      {
        id: "inspect",
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
        model: { provider: "faux-workflow", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
      {
        id: "report",
        type: "agent" as const,
        inputBindings: {
          workflow: { source: "workflow" as const },
          inspection: { source: "node" as const, nodeId: "inspect" },
        },
        inputSchema: {
          type: "object" as const,
          properties: {
            workflow: requestSchema(),
            inspection: inspectionSchema(),
          },
          required: ["workflow", "inspection"],
          additionalProperties: false as const,
        },
        outputSchema: reportSchema(),
        model: { provider: "faux-workflow", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
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
