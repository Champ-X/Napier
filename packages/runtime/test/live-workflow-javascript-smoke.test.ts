import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { WorkflowObjectSchema } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  createExecutionPlanBlueprint,
  createLocalAgentRuntime,
  defineExecutionPlanWorkflow,
  exportThreadReplayBundle,
  verifyThreadReplayBundle,
} from "../src/index.js";

const describeLive =
  process.env["NAPIER_LIVE_WORKFLOW_JAVASCRIPT_SMOKE"] === "1"
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

describeLive("live JavaScript Workflow Session", () => {
  it("executes typed cells in the production OS Sandbox", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-live-workflow-javascript-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "data");
    await mkdir(workspaceRoot, { recursive: true });
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: {},
    });
    try {
      const sourceThread = services.store.listThreads()[0]!;
      await services.store.updateAgent(sourceThread.agentId, {
        toolPolicy: "workspace",
        enabledTools: ["javascript_kernel"],
      });
      const sourcePlan = await services.store.createPlan(sourceThread.id, {
        objective: "Prove a production-Sandbox JavaScript Workflow Session.",
        steps: [
          {
            id: "calculate",
            title: "Calculate",
            description: "Calculate a typed sum.",
            verification: "Return exact typed JSON.",
          },
        ],
      });
      const blueprint = await createExecutionPlanBlueprint(
        services.store,
        sourceThread.id,
        sourcePlan.id,
      );
      const targetThread = await services.store.createThread({
        title: "Live JavaScript Workflow target",
        agentId: sourceThread.agentId,
      });
      const manifest = defineExecutionPlanWorkflow({
        name: "Live JavaScript calculation",
        version: 1,
        description: "Run stateful cells in the production Sandbox.",
        blueprint,
        inputSchema: valuesSchema(),
        outputSchema: outputSchema(),
        outputNodeId: "calculate",
        nodes: [
          {
            id: "calculate",
            type: "javascript",
            inputBindings: {
              workflow: { source: "workflow" },
            },
            inputSchema: {
              type: "object",
              properties: { workflow: valuesSchema() },
              required: ["workflow"],
              additionalProperties: false,
            },
            outputSchema: outputSchema(),
            cells: [
              "const LIVE_PRIVATE_WORKFLOW_VALUES = input.workflow.values.slice(); LIVE_PRIVATE_WORKFLOW_VALUES.length",
              "({ sum: LIVE_PRIVATE_WORKFLOW_VALUES.reduce((total, value) => total + value, 0) })",
            ],
            evaluationTimeoutMs: 1_000,
            timeoutMs: 10_000,
            maxAttempts: 1,
          },
        ],
      });
      const result = await services.workflows.run({
        threadId: targetThread.id,
        request: {
          manifest,
          input: { values: [3, 5, 7] },
        },
      });
      expect(result).toEqual(
        expect.objectContaining({
          status: "completed",
          output: { sum: 15 },
        }),
      );
      const sessions = await services.workspaceProcesses.list(targetThread.id);
      expect(sessions).toEqual([
        expect.objectContaining({
          sandbox:
            process.platform === "darwin"
              ? "macos-sandbox-exec"
              : "linux-bubblewrap",
          status: "cancelled",
          workspaceDeltaStatus: "unchanged",
        }),
      ]);
      const events = await services.store.listEvents(targetThread.id);
      expect(JSON.stringify(events)).not.toContain(
        "LIVE_PRIVATE_WORKFLOW_VALUES",
      );
      expect(
        verifyThreadReplayBundle(
          await exportThreadReplayBundle(services.store, targetThread.id),
        ).status,
      ).toBe("valid");
    } finally {
      await services.shutdown();
    }
  }, 30_000);
});

function valuesSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      values: {
        type: "array",
        items: { type: "integer", minimum: 0, maximum: 100 },
        minItems: 1,
        maxItems: 8,
      },
    },
    required: ["values"],
    additionalProperties: false,
  };
}

function outputSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      sum: { type: "integer", minimum: 0, maximum: 800 },
    },
    required: ["sum"],
    additionalProperties: false,
  };
}
