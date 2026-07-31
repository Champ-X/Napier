import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ExecutionPlanWorkflowLoopNode } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { CredentialReferenceStore } from "../src/credentials.js";
import { ModelRegistry } from "../src/models.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { LocalStore } from "../src/store.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";
import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";
import { defineExecutionPlanWorkflow } from "../src/workflow-manifests.js";
import { ExecutionPlanWorkflowRuntime } from "../src/workflow-runtime.js";

const describeLive =
  process.env["NAPIER_LIVE_WORKFLOW_LOOP_SMOKE"] === "1"
    ? describe
    : describe.skip;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describeLive("live bounded read-only Workflow Loop smoke", () => {
  it("feeds one typed result through a real model until iteration two", async () => {
    const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();
    if (!apiKey) {
      throw new Error(
        "Set DEEPSEEK_API_KEY before running the live Workflow Loop smoke test",
      );
    }
    const modelId =
      process.env["DEEPSEEK_MODEL"]?.trim() || "deepseek-v4-flash";
    const root = await mkdtemp(path.join(tmpdir(), "napier-live-loop-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
    });
    await store.initialize();
    try {
      await store.createCredentialReference({
        providerId: "deepseek",
        label: "Workflow Loop live smoke env",
        source: { type: "environment", variable: "DEEPSEEK_API_KEY" },
      });
      const credentials = new CredentialReferenceStore({
        store,
        env: { DEEPSEEK_API_KEY: apiKey },
      });
      const models = new ModelRegistry(credentials);
      await expect(
        models.isConfigured({ provider: "deepseek", id: modelId }),
      ).resolves.toBe(true);
      const sourceThread = store.listThreads()[0]!;
      const sourcePlan = await store.createPlan(sourceThread.id, {
        objective: "Refine one short typed statement through two iterations.",
        steps: [
          {
            id: "refine",
            title: "Refine statement",
            description:
              "Return iteration 1 on the first turn. On the next turn, use the previous output, return iteration 2, and improve the summary.",
            verification:
              "The output is strict JSON with iteration and summary only.",
          },
        ],
      });
      const blueprint = await createExecutionPlanBlueprint(
        store,
        sourceThread.id,
        sourcePlan.id,
      );
      const outputSchema = {
        type: "object" as const,
        properties: {
          iteration: { type: "integer" as const, minimum: 1, maximum: 2 },
          summary: {
            type: "string" as const,
            minLength: 1,
            maxLength: 200,
          },
        },
        required: ["iteration", "summary"],
        additionalProperties: false as const,
      };
      const node: ExecutionPlanWorkflowLoopNode = {
        id: "refine",
        type: "loop",
        inputBindings: {
          statement: { source: "workflow", path: ["statement"] },
        },
        inputSchema: {
          type: "object",
          properties: {
            statement: { type: "string", minLength: 1, maxLength: 200 },
          },
          required: ["statement"],
          additionalProperties: false,
        },
        outputSchema,
        until: { path: ["iteration"], equals: 2 },
        model: { provider: "deepseek", id: modelId },
        maxIterations: 2,
        iterationTimeoutMs: 45_000,
        timeoutMs: 90_000,
        maxAttempts: 1,
      };
      const manifest = defineExecutionPlanWorkflow({
        name: "Live bounded refinement Loop",
        version: 1,
        description: "Exercise typed sequential feedback with a real model.",
        blueprint,
        inputSchema: {
          type: "object",
          properties: {
            statement: { type: "string", minLength: 1, maxLength: 200 },
          },
          required: ["statement"],
          additionalProperties: false,
        },
        outputSchema,
        outputNodeId: "refine",
        nodes: [node],
      });
      const thread = await store.createThread({
        title: "Live Workflow Loop",
        agentId: sourceThread.agentId,
      });
      const result = await new ExecutionPlanWorkflowRuntime(
        store,
        new AgentRuntime(store, models),
      ).run({
        threadId: thread.id,
        request: {
          manifest,
          input: { statement: "Evidence should be clear and reproducible." },
        },
      });

      expect(result).toEqual(
        expect.objectContaining({
          status: "completed",
          output: expect.objectContaining({ iteration: 2 }),
        }),
      );
      const runs = store.listRuns(thread.id);
      expect(runs).toHaveLength(3);
      expect(
        runs
          .filter((run) => run.parentRunId)
          .every(
            (run) =>
              run.status === "completed" &&
              run.configuration?.executionMode === "workflow_loop_read_only",
          ),
      ).toBe(true);
      const events = await store.listEvents(thread.id);
      expect(
        events.filter(
          (event) => event.type === "workflow.loop.iteration.completed",
        ),
      ).toHaveLength(2);
      expect(
        verifyThreadReplayBundle(
          await exportThreadReplayBundle(store, thread.id),
        ).status,
      ).toBe("valid");
      expect(JSON.stringify(events)).not.toContain(apiKey);
    } finally {
      store.close();
    }
  }, 120_000);
});
