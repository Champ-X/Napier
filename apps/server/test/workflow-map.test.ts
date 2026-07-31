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

describe("Workflow Map HTTP path", () => {
  it("streams one concurrent Map through the public SSE contract", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-map-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
      sandbox: new UnsupportedSandboxAdapter("server-map-test"),
    });
    servicesToClose.push(services);
    const sourceThread = services.store.listThreads()[0]!;
    const sourcePlan = await services.store.createPlan(sourceThread.id, {
      objective: "Analyze a bounded HTTP document collection.",
      steps: [
        {
          id: "analyze",
          title: "Analyze documents",
          description: "Return the ID and length for each current document.",
          verification: "Every input item has one typed output.",
        },
      ],
    });
    const blueprint = await createExecutionPlanBlueprint(
      services.store,
      sourceThread.id,
      sourcePlan.id,
    );
    const inputSchema = {
      type: "object" as const,
      properties: {
        documents: {
          type: "array" as const,
          items: documentSchema(),
          minItems: 0,
          maxItems: 3,
        },
      },
      required: ["documents"],
      additionalProperties: false as const,
    };
    const outputSchema = {
      type: "array" as const,
      items: resultSchema(),
      minItems: 0,
      maxItems: 3,
    };
    const manifest = defineExecutionPlanWorkflow({
      name: "HTTP bounded Map",
      version: 1,
      description: "Execute read-only Agent items through HTTP SSE.",
      blueprint,
      inputSchema,
      outputSchema,
      outputNodeId: "analyze",
      maxConcurrency: 4,
      nodes: [
        {
          id: "analyze",
          type: "map",
          inputBindings: {
            documents: {
              source: "workflow",
              path: ["documents"],
            },
          },
          inputSchema,
          outputSchema,
          itemsPath: ["documents"],
          model: { provider: "faux-server-map", id: "faux-1" },
          maxConcurrency: 3,
          itemTimeoutMs: 5_000,
          timeoutMs: 15_000,
          maxAttempts: 2,
        },
      ],
    });
    const provider = fauxProvider({ provider: "faux-server-map" });
    const responseForItem = (context: { messages: unknown[] }) => {
      const prompt = JSON.stringify(context.messages);
      const document = documents().find((item) => prompt.includes(item.id));
      if (!document) throw new Error("Unknown HTTP Map item");
      return fauxAssistantMessage(
        JSON.stringify({ id: document.id, length: document.text.length }),
      );
    };
    provider.setResponses([responseForItem, responseForItem, responseForItem]);
    services.models.registerProvider(provider.provider);
    const targetThread = await services.store.createThread({
      title: "HTTP Map target",
      agentId: sourceThread.agentId,
    });

    const response = await createApp(services).request(
      `/api/threads/${targetThread.id}/workflows`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifest,
          input: { documents: documents() },
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
        output: [
          { id: "http_a", length: 5 },
          { id: "http_b", length: 4 },
          { id: "http_c", length: 5 },
        ],
      }),
    );
    const runs = services.store.listRuns(targetThread.id);
    expect(runs).toHaveLength(4);
    const coordinator = runs.find((run) => !run.parentRunId)!;
    expect(
      runs
        .filter((run) => run.parentRunId)
        .every(
          (run) =>
            run.parentRunId === coordinator.id &&
            run.configuration?.schemaVersion !== 1 &&
            run.configuration?.executionMode === "workflow_map_read_only",
        ),
    ).toBe(true);
    expect(
      (await services.store.listEvents(targetThread.id)).filter(
        (event) => event.type === "workflow.map.item.completed",
      ),
    ).toHaveLength(3);
  }, 20_000);
});

function documentSchema() {
  return {
    type: "object" as const,
    properties: {
      id: { type: "string" as const, minLength: 1, maxLength: 20 },
      text: { type: "string" as const, minLength: 1, maxLength: 100 },
    },
    required: ["id", "text"],
    additionalProperties: false as const,
  };
}

function resultSchema() {
  return {
    type: "object" as const,
    properties: {
      id: { type: "string" as const, minLength: 1, maxLength: 20 },
      length: { type: "integer" as const, minimum: 0, maximum: 100 },
    },
    required: ["id", "length"],
    additionalProperties: false as const,
  };
}

function documents() {
  return [
    { id: "http_a", text: "alpha" },
    { id: "http_b", text: "beta" },
    { id: "http_c", text: "gamma" },
  ];
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
