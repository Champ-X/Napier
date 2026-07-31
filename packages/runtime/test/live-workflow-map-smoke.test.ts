import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ExecutionPlanWorkflowMapNode,
  ExecutionPlanWorkflowReduceNode,
} from "@napier/contracts";
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
  process.env["NAPIER_LIVE_WORKFLOW_MAP_SMOKE"] === "1"
    ? describe
    : describe.skip;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describeLive("live bounded read-only Workflow Map smoke", () => {
  it("fans two typed items through a real model and preserves ordered evidence", async () => {
    const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();
    if (!apiKey) {
      throw new Error(
        "Set DEEPSEEK_API_KEY before running the live Workflow Map smoke test",
      );
    }
    const modelId =
      process.env["DEEPSEEK_MODEL"]?.trim() || "deepseek-v4-flash";
    const root = await mkdtemp(path.join(tmpdir(), "napier-live-map-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
    });
    await mkdir(workspaceRoot);
    await store.initialize();
    try {
      await store.createCredentialReference({
        providerId: "deepseek",
        label: "Workflow Map live smoke env",
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
        objective: "Extract typed facts from a bounded document collection.",
        steps: [
          {
            id: "extract",
            title: "Extract document fact",
            description:
              "Return one JSON object with the current document id and the number of ASCII characters in its text.",
            verification:
              "The object contains only id and length and satisfies the declared schema.",
          },
          {
            id: "total_length",
            title: "Total document lengths",
            description:
              "Deterministically sum the typed length from every Map result.",
            verification:
              "The output equals the sum of every extracted length.",
            dependsOn: ["extract"],
          },
        ],
      });
      const blueprint = await createExecutionPlanBlueprint(
        store,
        sourceThread.id,
        sourcePlan.id,
      );
      const documentSchema = {
        type: "object" as const,
        properties: {
          id: { type: "string" as const, minLength: 1, maxLength: 20 },
          text: { type: "string" as const, minLength: 1, maxLength: 20 },
        },
        required: ["id", "text"],
        additionalProperties: false as const,
      };
      const resultSchema = {
        type: "object" as const,
        properties: {
          id: { type: "string" as const, minLength: 1, maxLength: 20 },
          length: { type: "integer" as const, minimum: 1, maximum: 20 },
        },
        required: ["id", "length"],
        additionalProperties: false as const,
      };
      const mapOutputSchema = {
        type: "array" as const,
        items: resultSchema,
        minItems: 2,
        maxItems: 2,
      };
      const node: ExecutionPlanWorkflowMapNode = {
        id: "extract",
        type: "map",
        inputBindings: {
          documents: { source: "workflow", path: ["documents"] },
        },
        inputSchema: {
          type: "object",
          properties: {
            documents: {
              type: "array",
              items: documentSchema,
              minItems: 2,
              maxItems: 2,
            },
          },
          required: ["documents"],
          additionalProperties: false,
        },
        outputSchema: mapOutputSchema,
        itemsPath: ["documents"],
        model: { provider: "deepseek", id: modelId },
        maxConcurrency: 2,
        itemTimeoutMs: 45_000,
        timeoutMs: 90_000,
        maxAttempts: 1,
      };
      const reduceNode: ExecutionPlanWorkflowReduceNode = {
        id: "total_length",
        type: "reduce",
        inputBindings: {
          items: { source: "node", nodeId: "extract" },
        },
        inputSchema: {
          type: "object",
          properties: { items: mapOutputSchema },
          required: ["items"],
          additionalProperties: false,
        },
        outputSchema: { type: "integer", minimum: 2, maximum: 40 },
        itemsPath: ["items"],
        valuePath: ["length"],
        operation: "sum",
        timeoutMs: 5_000,
        maxAttempts: 1,
      };
      const manifest = defineExecutionPlanWorkflow({
        name: "Live bounded document Map Reduce",
        version: 1,
        description:
          "Exercise ordered typed fan-out and deterministic aggregation.",
        blueprint,
        inputSchema: {
          type: "object",
          properties: {
            documents: {
              type: "array",
              items: documentSchema,
              minItems: 2,
              maxItems: 2,
            },
          },
          required: ["documents"],
          additionalProperties: false,
        },
        outputSchema: reduceNode.outputSchema,
        outputNodeId: "total_length",
        nodes: [node, reduceNode],
        maxConcurrency: 4,
      });
      const thread = await store.createThread({
        title: "Live Workflow Map",
        agentId: sourceThread.agentId,
      });
      const workflows = new ExecutionPlanWorkflowRuntime(
        store,
        new AgentRuntime(store, models),
      );

      const result = await workflows.run({
        threadId: thread.id,
        request: {
          manifest,
          input: {
            documents: [
              { id: "doc_alpha", text: "alpha" },
              { id: "doc_beta", text: "beta" },
            ],
          },
        },
      });

      expect(result).toEqual(
        expect.objectContaining({
          status: "completed",
          output: 9,
          nodeResults: [
            expect.objectContaining({
              nodeId: "extract",
              output: [
                { id: "doc_alpha", length: 5 },
                { id: "doc_beta", length: 4 },
              ],
            }),
            expect.objectContaining({
              nodeId: "total_length",
              output: 9,
            }),
          ],
        }),
      );
      const runs = store.listRuns(thread.id);
      const coordinator = runs.find((run) =>
        runs.some((candidate) => candidate.parentRunId === run.id),
      )!;
      const children = runs.filter((run) => run.parentRunId === coordinator.id);
      const reduceRunId = result.nodeResults[1]!.runId!;
      expect(runs).toHaveLength(4);
      expect(children).toHaveLength(2);
      expect(
        children.every(
          (run) =>
            run.status === "completed" &&
            run.configuration?.executionMode === "workflow_map_read_only",
        ),
      ).toBe(true);
      const events = await store.listEvents(thread.id);
      expect(
        events.filter((event) => event.type === "workflow.map.item.completed"),
      ).toHaveLength(2);
      expect(
        events.filter((event) => event.type === "workflow.reduce.completed"),
      ).toHaveLength(1);
      expect(
        events.filter(
          (event) =>
            event.runId === reduceRunId &&
            (event.type === "model.response" || event.type.startsWith("tool.")),
        ),
      ).toHaveLength(0);
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
