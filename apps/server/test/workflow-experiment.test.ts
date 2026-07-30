import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type {
  ExecutionPlanWorkflowManifest,
  WorkflowObjectSchema,
} from "@napier/contracts";
import {
  createExecutionPlanBlueprint,
  defineExecutionPlanWorkflow,
  UnsupportedSandboxAdapter,
  validateExecutionPlanWorkflowExperimentResultFrame,
} from "@napier/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp, createServices } from "../src/app.js";
import {
  executeWorkflowExperiment,
  previewWorkflowExperiment,
} from "../../web/src/workflow-experiment-api.js";

const temporaryRoots: string[] = [];
const openServices: Awaited<ReturnType<typeof createServices>>[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const services of openServices.splice(0)) {
    await services.shutdownLocalRuntime();
  }
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Workflow experiment HTTP path", () => {
  it("previews and streams an isolated checkpoint rerun with a model override", async () => {
    const fixture = await createFixture();
    const app = createApp(fixture.services);
    const body = {
      manifest: fixture.manifest,
      fromNodeId: "report",
      modelOverrides: {
        report: { provider: "faux-http-experiment-alt", id: "faux-1" },
      },
    };
    const previewResponse = await app.request(
      `/api/threads/${fixture.sourceThreadId}/workflows/${fixture.sourcePlanId}/experiments/preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    expect(previewResponse.status).toBe(200);
    expect(previewResponse.headers.get("cache-control")).toBe("no-store");
    const preview = (await previewResponse.json()) as {
      previewSha256: string;
      reusedNodeIds: string[];
      rerunNodeIds: string[];
    };
    expect(preview).toEqual(
      expect.objectContaining({
        previewSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        reusedNodeIds: ["inspect"],
        rerunNodeIds: ["report"],
      }),
    );

    fixture.alternate.setResponses([
      fauxAssistantMessage('{"report":"HTTP experiment","approved":true}'),
    ]);
    const response = await app.request(
      `/api/threads/${fixture.sourceThreadId}/workflows/${fixture.sourcePlanId}/experiments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(
      response.headers.get(
        "x-napier-workflow-experiment-candidate-manifest-sha256",
      ),
    ).toMatch(/^[a-f0-9]{64}$/u);
    const frames = parseSseFrames(await response.text());
    expect(frames.at(-2)).toEqual(
      expect.objectContaining({ type: "snapshot" }),
    );
    const result = validateExecutionPlanWorkflowExperimentResultFrame(
      frames.at(-1),
    );
    expect(result).toEqual(
      expect.objectContaining({
        sourceThreadId: fixture.sourceThreadId,
        sourcePlanId: fixture.sourcePlanId,
        status: "completed",
        experiment: expect.objectContaining({
          comparison: expect.objectContaining({
            inputChange: "unchanged",
            outputChange: "changed",
            changedNodeIds: ["report"],
          }),
          result: expect.objectContaining({
            output: { report: "HTTP experiment", approved: true },
          }),
        }),
      }),
    );
    expect(result.targetThreadId).not.toBe(fixture.sourceThreadId);
  }, 20_000);

  it("completes the real Web client preview and comparison path", async () => {
    const fixture = await createFixture();
    const app = createApp(fixture.services);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const path =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        return app.request(path, init);
      }),
    );
    const request = {
      manifest: fixture.manifest,
      fromNodeId: "report",
      modelOverrides: {
        report: { provider: "faux-http-experiment-alt", id: "faux-1" },
      },
    };
    const preview = await previewWorkflowExperiment(
      fixture.sourceThreadId,
      fixture.sourcePlanId,
      request,
    );
    fixture.alternate.setResponses([
      fauxAssistantMessage('{"report":"Web experiment","approved":true}'),
    ]);
    const frames: string[] = [];
    const result = await executeWorkflowExperiment(
      fixture.sourceThreadId,
      fixture.sourcePlanId,
      {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      },
      preview,
      (frame) => frames.push(frame.type),
    );

    expect(result.experiment.result.output).toEqual({
      report: "Web experiment",
      approved: true,
    });
    expect(result.experiment.comparison).toEqual(
      expect.objectContaining({
        inputChange: "unchanged",
        outputChange: "changed",
        changedNodeIds: ["report"],
      }),
    );
    expect(frames.at(-2)).toBe("snapshot");
    expect(frames.at(-1)).toBe("workflow_experiment_result");
  }, 20_000);

  it("returns a no-mutation conflict until write-effect evidence is confirmed", async () => {
    const fixture = await createFixture();
    const reportRunId = fixture.sourceRunIds[1]!;
    await fixture.services.store.appendEvent({
      threadId: fixture.sourceThreadId,
      runId: reportRunId,
      type: "tool.started",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_http_write",
        toolName: "apply_patch",
        status: "started",
        effect: "write",
      },
    });
    await fixture.services.store.appendEvent({
      threadId: fixture.sourceThreadId,
      runId: reportRunId,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_http_write",
        toolName: "apply_patch",
        status: "completed",
        effect: "write",
      },
    });
    const app = createApp(fixture.services);
    const endpoint = `/api/threads/${fixture.sourceThreadId}/workflows/${fixture.sourcePlanId}/experiments`;
    const threadCount = fixture.services.store.listThreads().length;
    const rejected = await app.request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manifest: fixture.manifest,
        fromNodeId: "report",
      }),
    });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({
      error: "Workflow experiment requires explicit side-effect confirmation",
    });
    expect(fixture.services.store.listThreads()).toHaveLength(threadCount);

    const previewResponse = await app.request(`${endpoint}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manifest: fixture.manifest,
        fromNodeId: "report",
      }),
    });
    const preview = (await previewResponse.json()) as {
      previewSha256: string;
    };
    fixture.primary.setResponses([
      fauxAssistantMessage(
        '{"report":"Confirmed HTTP experiment","approved":true}',
      ),
    ]);
    const confirmed = await app.request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manifest: fixture.manifest,
        fromNodeId: "report",
        confirmSideEffects: true,
        expectedPreviewSha256: preview.previewSha256,
      }),
    });
    expect(confirmed.status).toBe(200);
    expect(
      validateExecutionPlanWorkflowExperimentResultFrame(
        parseSseFrames(await confirmed.text()).at(-1),
      ).status,
    ).toBe("completed");
  }, 20_000);
});

interface Fixture {
  services: Awaited<ReturnType<typeof createServices>>;
  manifest: ExecutionPlanWorkflowManifest;
  sourceThreadId: string;
  sourcePlanId: string;
  sourceRunIds: string[];
  primary: ReturnType<typeof fauxProvider>;
  alternate: ReturnType<typeof fauxProvider>;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-http-experiment-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const services = await createServices({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
    sandbox: new UnsupportedSandboxAdapter("http-workflow-experiment"),
  });
  openServices.push(services);
  const blueprintThread = services.store.listThreads()[0]!;
  const blueprintPlan = await services.store.createPlan(blueprintThread.id, {
    objective: "Create an HTTP experiment report.",
    steps: [
      {
        id: "inspect",
        title: "Inspect",
        description: "Inspect the typed HTTP input.",
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
    blueprintThread.id,
    blueprintPlan.id,
  );
  const sourceThread = await services.store.createThread({
    title: "HTTP experiment source",
    agentId: blueprintThread.agentId,
  });
  const primary = fauxProvider({ provider: "faux-http-experiment" });
  const alternate = fauxProvider({ provider: "faux-http-experiment-alt" });
  services.models.registerProvider(primary.provider);
  services.models.registerProvider(alternate.provider);
  const manifest = defineExecutionPlanWorkflow({
    name: "HTTP experiment",
    version: 1,
    description: "Exercise the public controlled rerun path.",
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
        model: { provider: "faux-http-experiment", id: "faux-1" },
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
        model: { provider: "faux-http-experiment", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  });
  primary.setResponses([
    fauxAssistantMessage('{"summary":"HTTP source","count":1}'),
    fauxAssistantMessage('{"report":"HTTP source","approved":true}'),
  ]);
  const source = await services.workflows.run({
    threadId: sourceThread.id,
    request: {
      manifest,
      input: { request: "Create the source HTTP report." },
    },
  });
  return {
    services,
    manifest,
    sourceThreadId: sourceThread.id,
    sourcePlanId: source.planId,
    sourceRunIds: source.nodeResults.map((node) => node.runId!),
    primary,
    alternate,
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

function parseSseFrames(text: string): unknown[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as unknown);
}
