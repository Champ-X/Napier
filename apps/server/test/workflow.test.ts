import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA } from "@napier/contracts";
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
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp, createServices } from "../src/app.js";
import { continueWorkflowBreakpoint } from "../../web/src/workflow-api.js";
import { projectWorkflowBreakpoint } from "../../web/src/workflow-breakpoint-view-model.js";

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
      artifacts: [
        {
          id: "http-report",
          path: "http-report.txt",
          kind: "file",
          description: "The verified HTTP Workflow deliverable.",
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
    await writeFile(
      path.join(workspaceRoot, "http-report.txt"),
      "verified HTTP report\n",
    );
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
    expect(
      frames.some(
        (frame) =>
          frame.type === "event" &&
          frame.event.type === "workflow.artifacts.settled",
      ),
    ).toBe(true);
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

  it("executes a model-free Tool Workflow through the public SSE route", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-server-tool-workflow-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
      sandbox: new UnsupportedSandboxAdapter("server-tool-workflow-test"),
    });
    openServices.push(services);
    const blueprintThread = services.store.listThreads()[0]!;
    const blueprintPlan = await services.store.createPlan(blueprintThread.id, {
      objective: "Inventory the workspace through a typed Tool node.",
      steps: [
        {
          id: "inventory",
          title: "Inventory",
          description: "List the workspace root.",
          verification: "Return a typed list-files receipt.",
        },
      ],
    });
    const blueprint = await createExecutionPlanBlueprint(
      services.store,
      blueprintThread.id,
      blueprintPlan.id,
    );
    const outputSchema = listFilesReceiptSchema();
    const manifest = defineExecutionPlanWorkflow({
      name: "HTTP Tool inventory",
      version: 1,
      description: "Execute one policy-checked model-free Tool node.",
      blueprint,
      inputSchema: requestSchema(),
      outputSchema,
      outputNodeId: "inventory",
      nodes: [
        {
          id: "inventory",
          type: "tool",
          tool: "list_files",
          effect: "read",
          inputBindings: {
            path: { source: "literal", value: "." },
            depth: { source: "literal", value: 1 },
          },
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", minLength: 1, maxLength: 20 },
              depth: { type: "integer", minimum: 0, maximum: 4 },
            },
            required: ["path", "depth"],
            additionalProperties: false,
          },
          outputSchema,
          timeoutMs: 5_000,
          maxAttempts: 2,
        },
      ],
    });
    const targetThread = await services.store.createThread({
      title: "HTTP Tool Workflow target",
      agentId: blueprintThread.agentId,
    });
    const app = createApp(services);
    const pausedResponse = await app.request(
      `/api/threads/${targetThread.id}/workflows`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifest,
          input: { request: "Inventory without a model." },
          breakBeforeNodeIds: ["inventory"],
        }),
      },
    );

    expect(pausedResponse.status).toBe(200);
    expect(
      pausedResponse.headers.get("x-napier-workflow-breakpoint-count"),
    ).toBe("1");
    const paused = validateExecutionPlanWorkflowResultFrame(
      parseSseFrames(await pausedResponse.text()).at(-1),
    );
    expect(paused.result).toEqual(
      expect.objectContaining({
        status: "paused",
        breakpoint: expect.objectContaining({ nodeId: "inventory" }),
        nodeResults: [],
      }),
    );
    expect(services.store.listRuns(targetThread.id)).toEqual([]);

    const projection = projectWorkflowBreakpoint(
      [services.store.getPlan(paused.planId)],
      await services.store.listEvents(targetThread.id),
    );
    expect(projection.status).toBe("open");
    if (projection.status !== "open") {
      throw new Error("Expected an open Workflow breakpoint");
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const requestPath =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        return app.request(requestPath, init);
      }),
    );
    const webFrames: string[] = [];
    const frame = await continueWorkflowBreakpoint(
      targetThread.id,
      manifest,
      projection.breakpoint,
      (streamFrame) => webFrames.push(streamFrame.type),
    );
    expect(webFrames).toEqual(
      expect.arrayContaining(["event", "snapshot", "workflow_result"]),
    );
    expect(frame.result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: expect.objectContaining({
          count: 0,
          truncated: false,
          pathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          entrySetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    const events = await services.store.listEvents(targetThread.id);
    expect(events.some((event) => event.type === "model.response")).toBe(false);
    expect(
      events.filter(
        (event) =>
          event.type === "tool.started" || event.type === "tool.completed",
      ),
    ).toHaveLength(2);
    expect(
      services.store.listRuns(targetThread.id).map((run) => run.source),
    ).toEqual(["workflow"]);
  });

  it("executes a model-free Deterministic Workflow through the public SSE route", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-server-deterministic-workflow-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
      sandbox: new UnsupportedSandboxAdapter(
        "server-deterministic-workflow-test",
      ),
    });
    openServices.push(services);
    const blueprintThread = services.store.listThreads()[0]!;
    const blueprintPlan = await services.store.createPlan(blueprintThread.id, {
      objective: "Shape one typed HTTP result without a model.",
      steps: [
        {
          id: "report",
          title: "Report",
          description: "Shape the Workflow input.",
          verification: "Return a deterministic typed report.",
        },
      ],
    });
    const blueprint = await createExecutionPlanBlueprint(
      services.store,
      blueprintThread.id,
      blueprintPlan.id,
    );
    const manifest = defineExecutionPlanWorkflow({
      name: "HTTP Deterministic report",
      version: 1,
      description: "Execute one model-free Deterministic node.",
      blueprint,
      inputSchema: requestSchema(),
      outputSchema: reportSchema(),
      outputNodeId: "report",
      nodes: [
        {
          id: "report",
          type: "deterministic",
          inputBindings: {
            workflow: { source: "workflow" },
          },
          inputSchema: {
            type: "object",
            properties: { workflow: requestSchema() },
            required: ["workflow"],
            additionalProperties: false,
          },
          outputSchema: reportSchema(),
          template: {
            kind: "object",
            properties: {
              report: {
                kind: "literal",
                value: "PRIVATE_HTTP_DETERMINISTIC_OUTPUT",
              },
              approved: { kind: "literal", value: true },
            },
          },
          timeoutMs: 5_000,
          maxAttempts: 2,
        },
      ],
    });
    const targetThread = await services.store.createThread({
      title: "HTTP Deterministic Workflow target",
      agentId: blueprintThread.agentId,
    });
    const response = await createApp(services).request(
      `/api/threads/${targetThread.id}/workflows`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifest,
          input: { request: "Shape the HTTP result." },
        }),
      },
    );

    expect(response.status).toBe(200);
    const frames = parseSseFrames(await response.text());
    const frame = validateExecutionPlanWorkflowResultFrame(frames.at(-1));
    expect(frame.result.output).toEqual({
      report: "PRIVATE_HTTP_DETERMINISTIC_OUTPUT",
      approved: true,
    });
    const events = await services.store.listEvents(targetThread.id);
    expect(events.some((event) => event.type === "model.response")).toBe(false);
    expect(
      events.filter(
        (event) => event.type === "workflow.deterministic.completed",
      ),
    ).toHaveLength(1);
    expect(
      JSON.stringify(
        events.filter((event) => event.type.startsWith("workflow.")),
      ),
    ).not.toContain("PRIVATE_HTTP_DETERMINISTIC_OUTPUT");
    expect(
      services.store.listRuns(targetThread.id).map((run) => run.source),
    ).toEqual(["workflow"]);
  });

  it("executes a deterministic Reduce Workflow through public SSE", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-server-reduce-workflow-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
      sandbox: new UnsupportedSandboxAdapter("server-reduce-workflow-test"),
    });
    openServices.push(services);
    const blueprintThread = services.store.listThreads()[0]!;
    const blueprintPlan = await services.store.createPlan(blueprintThread.id, {
      objective: "Sum typed values through public SSE.",
      steps: [
        {
          id: "total",
          title: "Total values",
          description: "Sum every typed integer.",
          verification: "Return the exact deterministic sum.",
        },
      ],
    });
    const blueprint = await createExecutionPlanBlueprint(
      services.store,
      blueprintThread.id,
      blueprintPlan.id,
    );
    const valuesSchema = {
      type: "array" as const,
      items: { type: "integer" as const },
      minItems: 0,
      maxItems: 16,
    };
    const inputSchema = {
      type: "object" as const,
      properties: { values: valuesSchema },
      required: ["values"],
      additionalProperties: false as const,
    };
    const manifest = defineExecutionPlanWorkflow({
      name: "HTTP deterministic Reduce",
      version: 1,
      description: "Execute one model-free Reduce node.",
      blueprint,
      inputSchema,
      outputSchema: { type: "integer" },
      outputNodeId: "total",
      nodes: [
        {
          id: "total",
          type: "reduce",
          inputBindings: {
            values: { source: "workflow", path: ["values"] },
          },
          inputSchema,
          outputSchema: { type: "integer" },
          itemsPath: ["values"],
          operation: "sum",
          timeoutMs: 5_000,
          maxAttempts: 2,
        },
      ],
    });
    const targetThread = await services.store.createThread({
      title: "HTTP Reduce Workflow target",
      agentId: blueprintThread.agentId,
    });
    const response = await createApp(services).request(
      `/api/threads/${targetThread.id}/workflows`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifest,
          input: { values: [2, 3, 4] },
        }),
      },
    );

    expect(response.status).toBe(200);
    const frames = parseSseFrames(await response.text());
    const frame = validateExecutionPlanWorkflowResultFrame(frames.at(-1));
    expect(frame.result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: 9,
        nodeResults: [
          expect.objectContaining({
            nodeId: "total",
            status: "completed",
            output: 9,
          }),
        ],
      }),
    );
    const events = await services.store.listEvents(targetThread.id);
    expect(
      events.filter((event) => event.type === "workflow.reduce.completed"),
    ).toHaveLength(1);
    expect(events.some((event) => event.type === "model.response")).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === "tool.started" || event.type === "tool.completed",
      ),
    ).toBe(false);
    expect(
      services.store.listRuns(targetThread.id).map((run) => run.source),
    ).toEqual(["workflow"]);
  });

  it("streams a conditional fallback without creating a node Run", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-server-conditional-workflow-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
      sandbox: new UnsupportedSandboxAdapter(
        "server-conditional-workflow-test",
      ),
    });
    openServices.push(services);
    const blueprintThread = services.store.listThreads()[0]!;
    const blueprintPlan = await services.store.createPlan(blueprintThread.id, {
      objective: "Return one conditional HTTP fallback.",
      steps: [
        {
          id: "fallback",
          title: "Conditional fallback",
          description: "Execute only when requested.",
          verification: "Return a typed report in both branches.",
        },
      ],
    });
    const blueprint = await createExecutionPlanBlueprint(
      services.store,
      blueprintThread.id,
      blueprintPlan.id,
    );
    const inputSchema = conditionalInputSchema();
    const manifest = defineExecutionPlanWorkflow({
      name: "HTTP conditional fallback",
      version: 1,
      description: "Exercise model-free conditional control through SSE.",
      blueprint,
      inputSchema,
      outputSchema: reportSchema(),
      outputNodeId: "fallback",
      nodes: [
        {
          id: "fallback",
          type: "agent",
          inputBindings: { workflow: { source: "workflow" } },
          inputSchema: {
            type: "object",
            properties: { workflow: inputSchema },
            required: ["workflow"],
            additionalProperties: false,
          },
          outputSchema: reportSchema(),
          when: { path: ["workflow", "execute"], equals: true },
          skipOutput: {
            report: "PRIVATE_HTTP_CONDITIONAL_FALLBACK",
            approved: true,
          },
          model: { provider: "missing-conditional", id: "missing-1" },
          timeoutMs: 5_000,
          maxAttempts: 2,
        },
      ],
    });
    const targetThread = await services.store.createThread({
      title: "HTTP conditional Workflow target",
      agentId: blueprintThread.agentId,
    });
    const response = await createApp(services).request(
      `/api/threads/${targetThread.id}/workflows`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifest,
          input: { execute: false },
        }),
      },
    );

    expect(response.status).toBe(200);
    const frames = parseSseFrames(await response.text());
    const frame = validateExecutionPlanWorkflowResultFrame(frames.at(-1));
    expect(frame.result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: {
          report: "PRIVATE_HTTP_CONDITIONAL_FALLBACK",
          approved: true,
        },
        nodeResults: [
          expect.objectContaining({
            nodeId: "fallback",
            attempt: 0,
            status: "skipped",
          }),
        ],
      }),
    );
    expect(services.store.listRuns(targetThread.id)).toHaveLength(0);
    const events = await services.store.listEvents(targetThread.id);
    expect(
      events.filter((event) => event.type === "workflow.node.skipped"),
    ).toHaveLength(1);
    expect(
      JSON.stringify(
        events.filter((event) => event.type.startsWith("workflow.")),
      ),
    ).not.toContain("PRIVATE_HTTP_CONDITIONAL_FALLBACK");
    const streamedEvents = frames.flatMap((value) => {
      const frameValue = record(value);
      return frameValue?.["type"] === "event" && record(frameValue["event"])
        ? [frameValue["event"] as unknown as { seq: number }]
        : [];
    });
    expect(streamedEvents.map((event) => event.seq)).toEqual(
      streamedEvents.map((_, index) => index + 1),
    );
  });

  it("streams parallel Agent nodes before their typed join through public SSE", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-server-parallel-workflow-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
      sandbox: new UnsupportedSandboxAdapter("server-parallel-workflow-test"),
    });
    openServices.push(services);
    const blueprintThread = services.store.listThreads()[0]!;
    const blueprintPlan = await services.store.createPlan(blueprintThread.id, {
      objective: "Run two HTTP analyses and join one report.",
      steps: [
        {
          id: "analyze_a",
          title: "Analyze left",
          description: "Analyze the left branch.",
          verification: "Return typed left analysis.",
        },
        {
          id: "analyze_b",
          title: "Analyze right",
          description: "Analyze the right branch.",
          verification: "Return typed right analysis.",
        },
        {
          id: "report",
          title: "Report",
          description: "Join both analyses.",
          verification: "Return one typed report.",
          dependsOn: ["analyze_a", "analyze_b"],
        },
      ],
    });
    const blueprint = await createExecutionPlanBlueprint(
      services.store,
      blueprintThread.id,
      blueprintPlan.id,
    );
    const branchNode = (id: "analyze_a" | "analyze_b") => ({
      id,
      type: "agent" as const,
      inputBindings: { workflow: { source: "workflow" as const } },
      inputSchema: {
        type: "object" as const,
        properties: { workflow: requestSchema() },
        required: ["workflow"],
        additionalProperties: false as const,
      },
      outputSchema: inspectionSchema(),
      model: { provider: "faux-server-parallel", id: "faux-1" },
      timeoutMs: 5_000,
      maxAttempts: 2,
    });
    const manifest = defineExecutionPlanWorkflow({
      name: "HTTP parallel report",
      version: 1,
      description: "Execute two Agent nodes concurrently through HTTP SSE.",
      blueprint,
      inputSchema: requestSchema(),
      outputSchema: reportSchema(),
      outputNodeId: "report",
      maxConcurrency: 2,
      nodes: [
        branchNode("analyze_a"),
        branchNode("analyze_b"),
        {
          id: "report",
          type: "agent",
          inputBindings: {
            left: { source: "node", nodeId: "analyze_a" },
            right: { source: "node", nodeId: "analyze_b" },
          },
          inputSchema: {
            type: "object",
            properties: {
              left: inspectionSchema(),
              right: inspectionSchema(),
            },
            required: ["left", "right"],
            additionalProperties: false,
          },
          outputSchema: reportSchema(),
          model: { provider: "faux-server-parallel", id: "faux-1" },
          timeoutMs: 5_000,
          maxAttempts: 2,
        },
      ],
    });
    const targetThread = await services.store.createThread({
      title: "HTTP parallel Workflow target",
      agentId: blueprintThread.agentId,
    });
    const provider = fauxProvider({
      provider: "faux-server-parallel",
      tokensPerSecond: 20,
    });
    provider.setResponses([
      fauxAssistantMessage(`{"summary":"${"L".repeat(120)}","count":1}`),
      fauxAssistantMessage(`{"summary":"${"R".repeat(120)}","count":1}`),
      fauxAssistantMessage('{"report":"Parallel HTTP report","approved":true}'),
    ]);
    services.models.registerProvider(provider.provider);
    const response = await createApp(services).request(
      `/api/threads/${targetThread.id}/workflows`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifest,
          input: { request: "Run parallel HTTP branches." },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-napier-workflow-max-concurrency")).toBe("2");
    const frames = parseSseFrames(await response.text());
    const result = validateExecutionPlanWorkflowResultFrame(frames.at(-1));
    expect(result.result.output).toEqual({
      report: "Parallel HTTP report",
      approved: true,
    });
    const events = frames.flatMap((frame) => {
      const value = record(frame);
      return value?.["type"] === "event" && record(value["event"])
        ? [
            value["event"] as unknown as {
              seq: number;
              type: string;
              payload: unknown;
            },
          ]
        : [];
    });
    const branchStarts = events.filter(
      (event) =>
        event.type === "workflow.node.started" &&
        ["analyze_a", "analyze_b"].includes(
          String(record(event.payload)?.["nodeId"]),
        ),
    );
    const branchCompletions = events.filter(
      (event) =>
        event.type === "workflow.node.completed" &&
        ["analyze_a", "analyze_b"].includes(
          String(record(event.payload)?.["nodeId"]),
        ),
    );
    expect(branchStarts).toHaveLength(2);
    expect(branchCompletions).toHaveLength(2);
    expect(Math.max(...branchStarts.map((event) => event.seq))).toBeLessThan(
      Math.min(...branchCompletions.map((event) => event.seq)),
    );
    expect(events.map((event) => event.seq)).toEqual(
      events.map((_, index) => index + 1),
    );
  }, 20_000);

  it("answers and resumes a model-free Approval through public HTTP routes", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-server-approval-workflow-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
      sandbox: new UnsupportedSandboxAdapter("server-approval-workflow-test"),
    });
    openServices.push(services);
    const sourceThread = services.store.listThreads()[0]!;
    const sourcePlan = await services.store.createPlan(sourceThread.id, {
      objective: "Approve one HTTP delivery.",
      steps: [
        {
          id: "approval",
          title: "Approval",
          description: "Wait for the operator.",
          verification: "Return the typed approval receipt.",
        },
      ],
    });
    const blueprint = await createExecutionPlanBlueprint(
      services.store,
      sourceThread.id,
      sourcePlan.id,
    );
    const outputSchema = structuredClone(
      EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA,
    );
    const manifest = defineExecutionPlanWorkflow({
      name: "HTTP Approval",
      version: 1,
      description: "Pause and resume one Approval node.",
      blueprint,
      inputSchema: requestSchema(),
      outputSchema,
      outputNodeId: "approval",
      nodes: [
        {
          id: "approval",
          type: "approval",
          header: "Release",
          question: "Approve this HTTP Workflow delivery?",
          approve: {
            label: "Approve",
            description: "Complete the Workflow.",
          },
          reject: {
            label: "Reject",
            description: "Block the Workflow.",
          },
          inputBindings: {
            workflow: { source: "workflow" },
          },
          inputSchema: {
            type: "object",
            properties: { workflow: requestSchema() },
            required: ["workflow"],
            additionalProperties: false,
          },
          outputSchema,
          timeoutMs: 60_000,
          maxAttempts: 2,
        },
      ],
    });
    const targetThread = await services.store.createThread({
      title: "HTTP Approval target",
      agentId: sourceThread.agentId,
    });
    const app = createApp(services);
    const waitingResponse = await app.request(
      `/api/threads/${targetThread.id}/workflows`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifest,
          input: { request: "Require HTTP approval." },
        }),
      },
    );
    const waiting = validateExecutionPlanWorkflowResultFrame(
      parseSseFrames(await waitingResponse.text()).at(-1),
    );
    expect(waiting.status).toBe("waiting");
    const decision = (
      await services.store.listOperatorDecisions(targetThread.id)
    )[0]!;

    const answerResponse = await app.request(
      `/api/threads/${targetThread.id}/operator-decisions/${decision.id}/answer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedOptionIds: ["option_1"],
          customText: "Approved through HTTP.",
        }),
      },
    );
    expect(answerResponse.status).toBe(202);

    const completedResponse = await app.request(
      `/api/threads/${targetThread.id}/workflows`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifest,
          planId: waiting.planId,
        }),
      },
    );
    const completed = validateExecutionPlanWorkflowResultFrame(
      parseSseFrames(await completedResponse.text()).at(-1),
    );
    expect(completed).toEqual(
      expect.objectContaining({
        status: "completed",
        result: expect.objectContaining({
          output: expect.objectContaining({
            approved: true,
            selectedOptionId: "option_1",
            customText: "Approved through HTTP.",
          }),
        }),
      }),
    );
    expect(
      (await services.store.listEvents(targetThread.id)).some(
        (event) => event.type === "model.response",
      ),
    ).toBe(false);
  });

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

function conditionalInputSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      execute: { type: "boolean" },
    },
    required: ["execute"],
    additionalProperties: false,
  };
}

function listFilesReceiptSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      count: { type: "integer", minimum: 0 },
      truncated: { type: "boolean" },
      pathSha256: { type: "string", minLength: 64, maxLength: 64 },
      entrySetSha256: { type: "string", minLength: 64, maxLength: 64 },
    },
    required: ["count", "truncated", "pathSha256", "entrySetSha256"],
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

function parseSseFrames(text: string): unknown[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as unknown);
}
