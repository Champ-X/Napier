import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { StreamFrame } from "@napier/contracts";
import {
  createExecutionPlanBlueprint,
  defineExecutionPlanWorkflow,
  UnsupportedSandboxAdapter,
  validateExecutionPlanWorkflowResultFrame,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, createServices } from "../src/app.js";

const roots: string[] = [];
const servicesToClose: Awaited<ReturnType<typeof createServices>>[] = [];

afterEach(async () => {
  for (const services of servicesToClose.splice(0)) {
    await services.shutdownLocalRuntime();
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Workflow Loop HTTP path", () => {
  it("streams a bounded read-only Loop through the public SSE contract", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-loop-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
      sandbox: new UnsupportedSandboxAdapter("server-loop-test"),
    });
    servicesToClose.push(services);
    const sourceThread = services.store.listThreads()[0]!;
    const sourcePlan = await services.store.createPlan(sourceThread.id, {
      objective: "Refine one HTTP result until complete.",
      steps: [
        {
          id: "refine",
          title: "Refine",
          description: "Advance the previous typed result by one iteration.",
          verification: "Stop when done is true.",
        },
      ],
    });
    const blueprint = await createExecutionPlanBlueprint(
      services.store,
      sourceThread.id,
      sourcePlan.id,
    );
    const manifest = defineExecutionPlanWorkflow({
      name: "HTTP bounded Loop",
      version: 1,
      description: "Execute sequential read-only Agent turns through HTTP SSE.",
      blueprint,
      inputSchema: inputSchema(),
      outputSchema: outputSchema(),
      outputNodeId: "refine",
      nodes: [
        {
          id: "refine",
          type: "loop",
          inputBindings: {
            goal: { source: "workflow", path: ["goal"] },
          },
          inputSchema: inputSchema(),
          outputSchema: outputSchema(),
          until: { path: ["done"], equals: true },
          model: { provider: "faux-server-loop", id: "faux-1" },
          maxIterations: 3,
          iterationTimeoutMs: 5_000,
          timeoutMs: 15_000,
          maxAttempts: 2,
        },
      ],
    });
    const provider = fauxProvider({ provider: "faux-server-loop" });
    provider.setResponses([
      fauxAssistantMessage(
        JSON.stringify({ done: false, iteration: 1, note: "first" }),
      ),
      (context) => {
        expect(JSON.stringify(context.messages)).toContain("first");
        return fauxAssistantMessage(
          JSON.stringify({ done: true, iteration: 2, note: "final" }),
        );
      },
    ]);
    services.models.registerProvider(provider.provider);
    const targetThread = await services.store.createThread({
      title: "HTTP Loop target",
      agentId: sourceThread.agentId,
    });

    const response = await createApp(services).request(
      `/api/threads/${targetThread.id}/workflows`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifest,
          input: { goal: "Produce the HTTP result." },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-napier-workflow-node-count")).toBe("1");
    const frame = validateExecutionPlanWorkflowResultFrame(
      parseSseFrames(await response.text()).at(-1),
    );
    expect(frame.result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { done: true, iteration: 2, note: "final" },
      }),
    );
    const runs = services.store.listRuns(targetThread.id);
    expect(runs).toHaveLength(3);
    const coordinator = runs.find((run) => !run.parentRunId)!;
    expect(
      runs
        .filter((run) => run.parentRunId)
        .every(
          (run) =>
            run.parentRunId === coordinator.id &&
            run.configuration?.schemaVersion !== 1 &&
            run.configuration?.executionMode === "workflow_loop_read_only",
        ),
    ).toBe(true);
    expect(
      (await services.store.listEvents(targetThread.id)).filter(
        (event) => event.type === "workflow.loop.iteration.completed",
      ),
    ).toHaveLength(2);
  });
});

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

function parseSseFrames(body: string): StreamFrame[] {
  return body
    .split("\n\n")
    .map((entry) =>
      entry
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6),
    )
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line) as StreamFrame);
}
