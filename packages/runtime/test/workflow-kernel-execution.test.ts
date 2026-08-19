import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type {
  ExecutionPlanBlueprint,
  WorkflowObjectSchema,
} from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentKernel } from "../src/agent-kernel.js";
import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";
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

describe("Workflow Kernel execution", () => {
  it("routes every Agent node through Kernel hooks", async () => {
    const fixture = await createFixture();
    const kernel = await createAgentKernel({
      profile: "base",
      runtime: fixture.runtime,
      models: fixture.models,
    });
    try {
      const turnStarts: string[] = [];
      kernel.hooks.on("turn.start", ({ runId }) => turnStarts.push(runId));
      const runPrompt = vi.spyOn(kernel, "runPrompt");
      const workflows = new ExecutionPlanWorkflowRuntime(
        fixture.store,
        kernel,
        fixture.runtime,
      );
      fixture.provider.setResponses([
        fauxAssistantMessage('{"summary":"Kernel inspection","count":1}'),
        fauxAssistantMessage(
          '{"report":"Kernel workflow report","approved":true}',
        ),
      ]);

      const result = await workflows.run({
        threadId: fixture.targetThreadId,
        request: {
          manifest: defineExecutionPlanWorkflow(
            workflowDefinition(fixture.blueprint),
          ),
          input: { request: "Run every Agent node through Kernel." },
        },
      });

      expect(result.status).toBe("completed");
      expect(result.output).toEqual({
        report: "Kernel workflow report",
        approved: true,
      });
      expect(runPrompt).toHaveBeenCalledTimes(2);
      expect(runPrompt).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          threadId: fixture.targetThreadId,
          source: "workflow",
        }),
      );
      expect(turnStarts).toHaveLength(2);
    } finally {
      await kernel.shutdown();
      fixture.store.close();
    }
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-workflow-kernel-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "state"),
  });
  await store.initialize();
  const sourceThread = store.listThreads()[0]!;
  const sourcePlan = await store.createPlan(sourceThread.id, {
    objective: "Create a Kernel-owned typed report.",
    steps: [
      {
        id: "inspect",
        title: "Inspect",
        description: "Inspect the typed input.",
        verification: "Return typed inspection JSON.",
      },
      {
        id: "report",
        title: "Report",
        description: "Produce the typed report.",
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
    title: "Kernel Workflow target",
    agentId: sourceThread.agentId,
  });
  const provider = fauxProvider({ provider: "faux-workflow-kernel" });
  const models = new ModelRegistry();
  models.registerProvider(provider.provider);
  return {
    store,
    models,
    provider,
    runtime: new AgentRuntime(store, models),
    blueprint,
    targetThreadId: targetThread.id,
  };
}

function workflowDefinition(blueprint: ExecutionPlanBlueprint) {
  return {
    name: "Kernel-owned typed report",
    version: 1,
    description: "Run two Agent nodes through the Kernel execution port.",
    blueprint,
    inputSchema: requestSchema(),
    outputSchema: reportSchema(),
    outputNodeId: "report",
    nodes: [
      {
        id: "inspect",
        type: "agent" as const,
        inputBindings: { workflow: { source: "workflow" as const } },
        inputSchema: objectSchema("workflow", requestSchema()),
        outputSchema: inspectionSchema(),
        model: { provider: "faux-workflow-kernel", id: "faux-1" },
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
        model: { provider: "faux-workflow-kernel", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  };
}

function objectSchema(
  name: string,
  value: WorkflowObjectSchema,
): WorkflowObjectSchema {
  return {
    type: "object",
    properties: { [name]: value },
    required: [name],
    additionalProperties: false,
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
