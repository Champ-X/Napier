import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type {
  ExecutionPlanWorkflowResultFrame,
  WorkflowObjectSchema,
} from "@napier/contracts";
import {
  createExecutionPlanBlueprint,
  defineExecutionPlanWorkflow,
  UnsupportedSandboxAdapter,
  validateExecutionPlanWorkflowResultFrame,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, createServices } from "../src/app.js";

const temporaryRoots: string[] = [];
const openServices: Awaited<ReturnType<typeof createServices>>[] = [];

afterEach(async () => {
  for (const services of openServices.splice(0)) {
    await services.shutdownLocalRuntime();
  }
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Workflow HTTP path", () => {
  it("streams the shared typed Workflow and a hash-bound result frame", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-workflow-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
      sandbox: new UnsupportedSandboxAdapter("server-workflow-test"),
    });
    openServices.push(services);
    const sourceThread = services.store.listThreads()[0]!;
    const sourcePlan = await services.store.createPlan(sourceThread.id, {
      objective: "Create a typed HTTP report.",
      steps: [
        {
          id: "inspect",
          title: "Inspect",
          description: "Inspect the HTTP input.",
          verification: "Return typed inspection JSON.",
        },
        {
          id: "report",
          title: "Report",
          description: "Produce the typed HTTP report.",
          verification: "Return typed report JSON.",
          dependsOn: ["inspect"],
        },
      ],
    });
    const blueprint = await createExecutionPlanBlueprint(
      services.store,
      sourceThread.id,
      sourcePlan.id,
    );
    const manifest = defineExecutionPlanWorkflow({
      name: "HTTP report",
      version: 1,
      description: "Execute one typed HTTP report Workflow.",
      blueprint,
      inputSchema: requestSchema(),
      outputSchema: reportSchema(),
      outputNodeId: "report",
      nodes: [
        {
          id: "inspect",
          type: "agent",
          inputBindings: { workflow: { source: "workflow" } },
          inputSchema: {
            type: "object",
            properties: { workflow: requestSchema() },
            required: ["workflow"],
            additionalProperties: false,
          },
          outputSchema: inspectionSchema(),
          model: { provider: "faux-server-workflow", id: "faux-1" },
          timeoutMs: 5_000,
          maxAttempts: 2,
        },
        {
          id: "report",
          type: "agent",
          inputBindings: {
            workflow: { source: "workflow" },
            inspection: { source: "node", nodeId: "inspect" },
          },
          inputSchema: {
            type: "object",
            properties: {
              workflow: requestSchema(),
              inspection: inspectionSchema(),
            },
            required: ["workflow", "inspection"],
            additionalProperties: false,
          },
          outputSchema: reportSchema(),
          model: { provider: "faux-server-workflow", id: "faux-1" },
          timeoutMs: 5_000,
          maxAttempts: 2,
        },
      ],
    });
    const targetThread = await services.store.createThread({
      title: "HTTP Workflow target",
      agentId: sourceThread.agentId,
    });
    const provider = fauxProvider({ provider: "faux-server-workflow" });
    provider.setResponses([
      fauxAssistantMessage('{"summary":"HTTP inspection","count":1}'),
      fauxAssistantMessage(
        '{"report":"PRIVATE_HTTP_WORKFLOW_OUTPUT","approved":true}',
      ),
    ]);
    services.models.registerProvider(provider.provider);
    const app = createApp(services);

    const rejectedRevision = await app.request(
      `/api/threads/${targetThread.id}/workflows`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifest,
          input: { request: "Attempt to pin a historical Agent policy." },
          agentRevision: 1,
        }),
      },
    );
    expect(rejectedRevision.status).toBe(400);
    expect(services.store.listPlans(targetThread.id)).toEqual([]);

    const response = await app.request(
      `/api/threads/${targetThread.id}/workflows`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifest,
          input: { request: "Create the HTTP report." },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("x-napier-workflow-manifest-sha256")).toBe(
      manifest.contentSha256,
    );
    expect(response.headers.get("x-napier-workflow-node-count")).toBe("2");
    const frames = parseSseFrames(await response.text());
    expect(frames.at(-2)).toEqual(
      expect.objectContaining({ type: "snapshot" }),
    );
    const result = validateExecutionPlanWorkflowResultFrame(frames.at(-1));
    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        result: expect.objectContaining({
          output: {
            report: "PRIVATE_HTTP_WORKFLOW_OUTPUT",
            approved: true,
          },
        }),
      }),
    );
    const durableWorkflow = JSON.stringify(
      (await services.store.listEvents(targetThread.id)).filter((event) =>
        event.type.startsWith("workflow."),
      ),
    );
    expect(durableWorkflow).not.toContain("PRIVATE_HTTP_WORKFLOW_OUTPUT");

    const resumeResponse = await app.request(
      `/api/threads/${targetThread.id}/workflows`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifest,
          planId: result.planId,
        }),
      },
    );
    expect(resumeResponse.status).toBe(200);
    expect(
      validateExecutionPlanWorkflowResultFrame(
        parseSseFrames(await resumeResponse.text()).at(-1),
      ).result,
    ).toEqual(expect.objectContaining({ resumed: true }));
  }, 20_000);

  it("rejects malformed requests before starting an SSE execution", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-workflow-"));
    temporaryRoots.push(root);
    const services = await createServices({
      workspaceRoot: root,
      dataRoot: path.join(root, "data"),
      sandbox: new UnsupportedSandboxAdapter("server-workflow-invalid"),
    });
    openServices.push(services);
    const thread = services.store.listThreads()[0]!;
    const response = await createApp(services).request(
      `/api/threads/${thread.id}/workflows`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifest: {}, input: {}, extra: true }),
      },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Workflow execution request is invalid",
    });
    expect(services.store.listPlans(thread.id)).toEqual([]);
  });
});

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

function parseSseFrames(text: string): unknown[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as unknown);
}
