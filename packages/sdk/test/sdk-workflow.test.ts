import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { WorkflowObjectSchema } from "@napier/contracts";
import {
  exportThreadReplayBundle,
  LocalStore,
  UnsupportedSandboxAdapter,
  verifyThreadReplayBundle,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  createNapierClient,
  loadNapierWorkflow,
  type DefineNapierWorkflowInput,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

type DraftRequest = {
  text: string;
  publish: boolean;
};

type DraftReport = {
  message: string;
};

type MapRequest = {
  items: string[];
};

type MapReport = Array<{
  item: string;
}>;

type ReduceRequest = {
  values: number[];
};

type ReduceReport = number;

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier TypeScript SDK Workflows", () => {
  it("defines, serializes, executes, and resumes through one local Ledger", async () => {
    const fixture = await createFixture("execute");
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sdk-workflow-test"),
    });
    const defined = await client.defineWorkflow<DraftRequest, DraftReport>(
      draftWorkflowDefinition(),
    );
    const workflow = loadNapierWorkflow<DraftRequest, DraftReport>(
      JSON.parse(JSON.stringify(defined.manifest)),
    );
    const tampered = structuredClone(defined.manifest);
    tampered.nodes[0]!.timeoutMs += 1;
    expect(() =>
      loadNapierWorkflow<DraftRequest, DraftReport>(tampered),
    ).toThrow("content hash mismatch");
    const eventTypes: string[] = [];
    const execution = await client.runWorkflow({
      workflow,
      input: { text: "SDK evidence", publish: false },
      onEvent: (event) => {
        eventTypes.push(event.type);
      },
    });

    expect(execution).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { message: "Draft retained by SDK Workflow" },
      }),
    );
    expect(execution.result.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "normalize",
        attempt: 1,
        status: "completed",
        runId: expect.stringMatching(/^run_[a-z0-9]{20}$/u),
      }),
      expect.objectContaining({
        nodeId: "publish",
        attempt: 0,
        status: "skipped",
      }),
    ]);
    expect(execution.result.nodeResults[1]).not.toHaveProperty("runId");
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "workflow.started",
        "workflow.node.started",
        "workflow.node.completed",
        "workflow.node.skipped",
        "workflow.completed",
      ]),
    );

    const resumed = await client.resumeWorkflow({
      workflow,
      threadId: execution.threadId,
      planId: execution.planId,
    });
    expect(resumed.result.resumed).toBe(true);
    expect(resumed.output).toEqual(execution.output);
    await client.close();
    await client.close();
    await expect(
      client.runWorkflow({
        workflow,
        input: { text: "Closed client", publish: true },
      }),
    ).rejects.toThrow("client is closed");

    const store = await openStore(fixture);
    expect(store.listRuns(execution.threadId)).toHaveLength(1);
    const events = await store.listEvents(execution.threadId);
    expect(
      events.filter((event) => event.type === "workflow.node.skipped"),
    ).toHaveLength(1);
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(store, execution.threadId),
      ).status,
    ).toBe("valid");
    store.close();
  });

  it("rejects invalid definitions, inputs, and cancellation before mutation", async () => {
    const fixture = await createFixture("preflight");
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sdk-preflight-test"),
    });
    const invalid = draftWorkflowDefinition();
    invalid.nodes[1] = {
      ...invalid.nodes[1]!,
      when: { path: ["workflow", "constructor"], equals: true },
    };
    await expect(
      client.defineWorkflow<DraftRequest, DraftReport>(invalid),
    ).rejects.toThrow("path segment is invalid");

    const workflow = await client.defineWorkflow<DraftRequest, DraftReport>(
      draftWorkflowDefinition(),
    );
    await expect(
      client.runWorkflow({
        workflow,
        input: { text: "", publish: true },
      }),
    ).rejects.toThrow("does not match its schema");
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.runWorkflow({
        workflow,
        input: { text: "Do not persist", publish: true },
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    await client.close();

    const store = await openStore(fixture);
    const threads = store.listThreads();
    expect(threads).toHaveLength(2);
    expect(
      threads.flatMap((thread) => store.listPlans(thread.id)),
    ).toHaveLength(1);
    expect(store.listRuns(workflow.sourceThreadId)).toHaveLength(0);
    store.close();
  });

  it("keeps concurrent executions isolated and retries a blocked node explicitly", async () => {
    const fixture = await createFixture("isolation");
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sdk-isolation-test"),
    });
    const workflow = await client.defineWorkflow<DraftRequest, DraftReport>(
      draftWorkflowDefinition(),
    );
    const [left, right] = await Promise.all([
      client.runWorkflow({
        workflow,
        input: { text: "Left SDK run", publish: true },
      }),
      client.runWorkflow({
        workflow,
        input: { text: "Right SDK run", publish: true },
      }),
    ]);
    expect(left.threadId).not.toBe(right.threadId);
    expect(left.output).toEqual({ message: "Left SDK run" });
    expect(right.output).toEqual({ message: "Right SDK run" });

    const blockedWorkflow = await client.defineWorkflow<
      DraftRequest,
      DraftReport
    >(blockedWorkflowDefinition());
    const blocked = await client.runWorkflow({
      workflow: blockedWorkflow,
      input: { text: "Retry missing provider", publish: true },
    });
    expect(blocked.result.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "publish",
        attempt: 1,
        status: "blocked",
      }),
    ]);
    const retried = await client.resumeWorkflow({
      workflow: blockedWorkflow,
      threadId: blocked.threadId,
      planId: blocked.planId,
      retryBlocked: true,
    });
    expect(retried.result.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "publish",
        attempt: 2,
        status: "blocked",
      }),
    ]);
    await client.close();

    const store = await openStore(fixture);
    expect(store.listRuns(blocked.threadId)).toHaveLength(2);
    expect(
      (await store.listEvents(blocked.threadId)).filter(
        (event) => event.type === "workflow.node.failed",
      ),
    ).toHaveLength(2);
    store.close();
  });

  it("aborts and settles an active Workflow before closing shared services", async () => {
    const fixture = await createFixture("active-close");
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sdk-active-close-test"),
    });
    const workflow = await client.defineWorkflow<DraftRequest, DraftReport>(
      draftWorkflowDefinition(),
    );
    let releaseStarted!: () => void;
    const startedGate = new Promise<void>((resolve) => {
      releaseStarted = resolve;
    });
    let releaseCallback!: () => void;
    const callbackGate = new Promise<void>((resolve) => {
      releaseCallback = resolve;
    });
    const executionPromise = client.runWorkflow({
      workflow,
      input: { text: "Cancel before close", publish: true },
      onEvent: async (event) => {
        if (event.type === "workflow.node.started") {
          releaseStarted();
          await callbackGate;
        }
      },
    });
    await startedGate;
    const closing = client.close();
    releaseCallback();
    const execution = await executionPromise;
    expect(execution.status).toBe("cancelled");
    await closing;

    const store = await openStore(fixture);
    expect(store.listRuns(execution.threadId)).toEqual([
      expect.objectContaining({ status: "cancelled" }),
    ]);
    expect(
      (await store.listEvents(execution.threadId)).some(
        (event) => event.type === "workflow.cancelled",
      ),
    ).toBe(true);
    store.close();
  });

  it("runs the built SDK example as a real external Node application", async () => {
    const fixture = await createFixture("example");
    const examplePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../examples/typed-workflow.mjs",
    );
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      examplePath,
      fixture.workspaceRoot,
      fixture.dataRoot,
    ]);
    expect(stderr).toBe("");
    const output = JSON.parse(stdout) as Record<string, unknown>;
    expect(output).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { message: "Draft retained by SDK Workflow" },
        runCount: 1,
        skippedNodeCount: 1,
      }),
    );
    expect(output["manifestSha256"]).toMatch(/^[a-f0-9]{64}$/u);
    expect(output["eventTypes"]).toEqual(
      expect.arrayContaining([
        "workflow.started",
        "workflow.node.completed",
        "workflow.node.skipped",
        "workflow.completed",
      ]),
    );
  });

  it("defines and reloads a typed bounded Map manifest", async () => {
    const fixture = await createFixture("map-definition");
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sdk-map-definition-test"),
    });
    const workflow = await client.defineWorkflow<MapRequest, MapReport>(
      mapWorkflowDefinition(),
    );
    const loaded = loadNapierWorkflow<MapRequest, MapReport>(
      JSON.parse(JSON.stringify(workflow.manifest)),
    );

    expect(loaded.manifest.nodes).toEqual([
      expect.objectContaining({
        id: "map_items",
        type: "map",
        itemsPath: ["items"],
        maxConcurrency: 3,
        itemTimeoutMs: 5_000,
      }),
    ]);
    await client.close();
  });

  it("defines and executes a deterministic Reduce through the SDK", async () => {
    const fixture = await createFixture("reduce-execution");
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sdk-reduce-execution-test"),
    });
    const workflow = await client.defineWorkflow<ReduceRequest, ReduceReport>(
      reduceWorkflowDefinition(),
    );
    const eventTypes: string[] = [];
    const execution = await client.runWorkflow({
      workflow,
      input: { values: [2, 3, 4] },
      onEvent: (event) => {
        eventTypes.push(event.type);
      },
    });

    expect(execution).toEqual(
      expect.objectContaining({
        status: "completed",
        output: 9,
        result: expect.objectContaining({
          nodeResults: [
            expect.objectContaining({
              nodeId: "total",
              status: "completed",
              output: 9,
            }),
          ],
        }),
      }),
    );
    expect(eventTypes).toContain("workflow.reduce.completed");
    await client.close();
  });
});

function draftWorkflowDefinition(): DefineNapierWorkflowInput<
  DraftRequest,
  DraftReport
> {
  const requestSchema = draftRequestSchema();
  const normalizedSchema = normalizedDraftSchema();
  return {
    name: "SDK typed draft",
    version: 1,
    description:
      "Normalize one typed request and conditionally publish its output.",
    plan: {
      objective: "Normalize and publish one typed SDK request.",
      steps: [
        planStep("normalize", "Normalize input"),
        {
          ...planStep("publish", "Publish output"),
          dependsOn: ["normalize"],
        },
      ],
    },
    inputSchema: requestSchema,
    outputSchema: draftReportSchema(),
    outputNodeId: "publish",
    maxConcurrency: 2,
    nodes: [
      {
        id: "normalize",
        type: "deterministic",
        inputBindings: {
          workflow: { source: "workflow" },
        },
        inputSchema: objectSchema({ workflow: requestSchema }),
        outputSchema: normalizedSchema,
        template: {
          kind: "object",
          properties: {
            text: { kind: "input", path: ["workflow", "text"] },
          },
        },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
      {
        id: "publish",
        type: "deterministic",
        inputBindings: {
          workflow: { source: "workflow" },
          normalized: { source: "node", nodeId: "normalize" },
        },
        inputSchema: objectSchema({
          workflow: requestSchema,
          normalized: normalizedSchema,
        }),
        outputSchema: draftReportSchema(),
        when: { path: ["workflow", "publish"], equals: true },
        skipOutput: { message: "Draft retained by SDK Workflow" },
        template: {
          kind: "object",
          properties: {
            message: { kind: "input", path: ["normalized", "text"] },
          },
        },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  };
}

function blockedWorkflowDefinition(): DefineNapierWorkflowInput<
  DraftRequest,
  DraftReport
> {
  const requestSchema = draftRequestSchema();
  return {
    name: "SDK blocked draft",
    version: 1,
    description: "Exercise explicit SDK Workflow retries.",
    plan: {
      objective: "Attempt one unavailable SDK Agent node.",
      steps: [planStep("publish", "Publish output")],
    },
    inputSchema: requestSchema,
    outputSchema: draftReportSchema(),
    outputNodeId: "publish",
    nodes: [
      {
        id: "publish",
        type: "agent",
        inputBindings: {
          workflow: { source: "workflow" },
        },
        inputSchema: objectSchema({ workflow: requestSchema }),
        outputSchema: draftReportSchema(),
        model: { provider: "missing-sdk-provider", id: "missing-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  };
}

function mapWorkflowDefinition(): DefineNapierWorkflowInput<
  MapRequest,
  MapReport
> {
  const itemSchema = {
    type: "string" as const,
    minLength: 1,
    maxLength: 100,
  };
  const inputSchema = objectSchema({
    items: {
      type: "array",
      items: itemSchema,
      minItems: 0,
      maxItems: 8,
    },
  });
  const outputSchema = {
    type: "array" as const,
    items: objectSchema({ item: itemSchema }),
    minItems: 0,
    maxItems: 8,
  };
  return {
    name: "SDK typed Map",
    version: 1,
    description: "Define one bounded read-only Agent Map.",
    plan: {
      objective: "Map one typed SDK collection.",
      steps: [planStep("map_items", "Map items")],
    },
    inputSchema,
    outputSchema,
    outputNodeId: "map_items",
    nodes: [
      {
        id: "map_items",
        type: "map",
        inputBindings: {
          items: { source: "workflow", path: ["items"] },
        },
        inputSchema,
        outputSchema,
        itemsPath: ["items"],
        model: { provider: "openai", id: "gpt-4.1-mini" },
        maxConcurrency: 3,
        itemTimeoutMs: 5_000,
        timeoutMs: 30_000,
        maxAttempts: 2,
      },
    ],
  };
}

function reduceWorkflowDefinition(): DefineNapierWorkflowInput<
  ReduceRequest,
  ReduceReport
> {
  const valuesSchema = {
    type: "array" as const,
    items: { type: "integer" as const },
    minItems: 0,
    maxItems: 16,
  };
  const inputSchema = objectSchema({ values: valuesSchema });
  return {
    name: "SDK deterministic Reduce",
    version: 1,
    description: "Sum typed values without a model call.",
    plan: {
      objective: "Reduce one typed SDK collection.",
      steps: [planStep("total", "Total values")],
    },
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
  };
}

function planStep(id: string, title: string) {
  return {
    id,
    title,
    description: `${title} through the SDK Workflow.`,
    verification: `${title} satisfies its runtime Schema.`,
  };
}

function draftRequestSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      text: { type: "string", minLength: 1, maxLength: 200 },
      publish: { type: "boolean" },
    },
    required: ["text", "publish"],
    additionalProperties: false,
  };
}

function normalizedDraftSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      text: { type: "string", minLength: 1, maxLength: 200 },
    },
    required: ["text"],
    additionalProperties: false,
  };
}

function draftReportSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      message: { type: "string", minLength: 1, maxLength: 200 },
    },
    required: ["message"],
    additionalProperties: false,
  };
}

function objectSchema(
  properties: WorkflowObjectSchema["properties"],
): WorkflowObjectSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

async function createFixture(label: string) {
  const root = await mkdtemp(path.join(tmpdir(), `napier-sdk-${label}-`));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  return { workspaceRoot, dataRoot };
}

async function openStore(fixture: {
  workspaceRoot: string;
  dataRoot: string;
}): Promise<LocalStore> {
  const store = new LocalStore(fixture);
  await store.initialize();
  return store;
}
