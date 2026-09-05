import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { WorkflowObjectSchema } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

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

describe("Workflow Tool retry lineage", () => {
  it("blocks retryBlocked after a write completed before output validation failed", async () => {
    const fixture = await createFixture();
    const manifest = defineExecutionPlanWorkflow({
      name: "Write exactly once",
      version: 1,
      description: "Prove a failed projection cannot duplicate a write.",
      blueprint: fixture.blueprint,
      inputSchema: requestSchema(),
      outputSchema: incompatibleOutputSchema(),
      outputNodeId: "write",
      nodes: [
        {
          id: "write",
          type: "tool",
          tool: "apply_patch",
          effect: "write",
          inputBindings: {
            operation: { source: "literal", value: "create" },
            path: { source: "literal", value: "retry-once.txt" },
            expectedSha256: { source: "literal", value: null },
            content: { source: "literal", value: "written exactly once\n" },
          },
          inputSchema: patchInputSchema(),
          // The mutation succeeds first; this deliberately fails only while
          // projecting its canonical result into the Workflow output.
          outputSchema: incompatibleOutputSchema(),
          timeoutMs: 5_000,
          maxAttempts: 2,
        },
      ],
    });

    const first = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: { manifest, input: { request: "Write once." } },
    });
    expect(first.nodeResults).toEqual([
      expect.objectContaining({ errorCode: "output_invalid", attempt: 1 }),
    ]);
    await expect(
      readFile(path.join(fixture.workspaceRoot, "retry-once.txt"), "utf8"),
    ).resolves.toBe("written exactly once\n");

    const retried = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: { manifest, planId: first.planId, retryBlocked: true },
    });
    expect(retried.nodeResults).toEqual([
      expect.objectContaining({ errorCode: "retry_unsafe", attempt: 2 }),
    ]);
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events.filter((event) => event.type === "tool.started"),
    ).toHaveLength(1);
    expect(
      events.find(
        (event) =>
          event.type === "tool.blocked" &&
          record(event.payload)?.["reason"] === "prior_execution_started",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        errorCode: "TOOL_EXECUTION_RETRY_LINEAGE_REJECTED",
        priorEffectBoundary: true,
        priorOutcome: "failed",
      }),
    );
    fixture.store.close();
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-workflow-lineage-"));
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
    objective: "Write one file.",
    steps: [
      {
        id: "write",
        title: "Write",
        description: "Write one file.",
        verification: "The file exists exactly once.",
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    store,
    sourceThread.id,
    sourcePlan.id,
  );
  const target = await store.createThread({
    title: "Workflow lineage target",
    agentId: sourceThread.agentId,
  });
  await store.updateAgent(target.agentId, {
    toolPolicy: "workspace",
    enabledTools: ["apply_patch"],
  });
  const agentRuntime = new AgentRuntime(store, new ModelRegistry());
  return {
    store,
    workspaceRoot,
    blueprint,
    threadId: target.id,
    workflows: new ExecutionPlanWorkflowRuntime(store, agentRuntime),
  };
}

function requestSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: { request: { type: "string", minLength: 1, maxLength: 50 } },
    required: ["request"],
    additionalProperties: false,
  };
}

function patchInputSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["create"] },
      path: { type: "string", minLength: 1, maxLength: 200 },
      expectedSha256: { type: "null" },
      content: { type: "string", minLength: 1, maxLength: 200 },
    },
    required: ["operation", "path", "expectedSha256", "content"],
    additionalProperties: false,
  };
}

function incompatibleOutputSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: { impossible: { type: "boolean" } },
    required: ["impossible"],
    additionalProperties: false,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
