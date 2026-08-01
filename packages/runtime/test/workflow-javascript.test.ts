import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  CreateExecutionPlanRequest,
  ExecutionPlanWorkflowManifest,
  WorkflowObjectSchema,
} from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import type { OsSandboxAdapter } from "../src/sandbox.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";
import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";
import { defineExecutionPlanWorkflow } from "../src/workflow-manifests.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Workflow JavaScript Session nodes", () => {
  it("shares bounded state within one node and recovers its typed output", async () => {
    const fixture = await createFixture();
    const result = await fixture.services.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: { values: [1, 2, 3] },
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { sum: 6, count: 3 },
        nodeResults: [
          expect.objectContaining({
            nodeId: "calculate",
            status: "completed",
            attempt: 1,
            output: { sum: 6, count: 3 },
          }),
        ],
      }),
    );
    const events = await fixture.services.store.listEvents(fixture.threadId);
    expect(
      events.find((event) => event.type === "workflow.javascript.completed")
        ?.payload,
    ).toEqual(
      expect.objectContaining({
        nodeId: "calculate",
        cellCount: 2,
        inputBindingRequestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        cellRequestSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        cellResultSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const publicEvents = JSON.stringify(
      events.filter((event) => event.visibility !== "hidden"),
    );
    expect(publicEvents).not.toContain("PRIVATE_CELL_SOURCE");
    expect(publicEvents).not.toContain("PRIVATE_CELL_CONSOLE");
    expect(publicEvents).not.toContain('"sum":6');
    const replay = await exportThreadReplayBundle(
      fixture.services.store,
      fixture.threadId,
    );
    expect(verifyThreadReplayBundle(replay).status).toBe("valid");
    const tamperedReplay = structuredClone(replay);
    const javascriptEvent = tamperedReplay.events.find(
      (event) => event.type === "workflow.javascript.completed",
    );
    if (
      !javascriptEvent ||
      !javascriptEvent.payload ||
      typeof javascriptEvent.payload !== "object" ||
      Array.isArray(javascriptEvent.payload)
    ) {
      throw new Error("JavaScript completion evidence is missing");
    }
    javascriptEvent.payload["javascriptConfigurationSha256"] = "0".repeat(64);
    expect(verifyThreadReplayBundle(tamperedReplay).status).toBe("invalid");

    await fixture.services.shutdown();
    const reopened = await createLocalAgentRuntime({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: directSandbox(),
    });
    try {
      const recovered = await reopened.workflows.run({
        threadId: fixture.threadId,
        request: {
          manifest: fixture.manifest,
          planId: result.planId,
        },
      });
      expect(recovered).toEqual(
        expect.objectContaining({
          status: "completed",
          output: { sum: 6, count: 3 },
        }),
      );
      expect(
        (await reopened.store.listEvents(fixture.threadId)).filter(
          (event) => event.type === "workflow.javascript.completed",
        ),
      ).toHaveLength(1);
    } finally {
      await reopened.shutdown();
    }
  }, 20_000);

  it("recovers terminal output after Run settlement fails", async () => {
    const fixture = await createFixture();
    const originalFinishRun = fixture.services.store.finishRun.bind(
      fixture.services.store,
    );
    let rejectedCompletion = false;
    const finishRun = vi
      .spyOn(fixture.services.store, "finishRun")
      .mockImplementation(async (...args) => {
        if (!rejectedCompletion && args[1] === "completed") {
          rejectedCompletion = true;
          throw new Error("INJECTED_JAVASCRIPT_RUN_SETTLEMENT_FAILURE");
        }
        return originalFinishRun(...args);
      });
    let planId: string | undefined;
    try {
      const first = await fixture.services.workflows.run({
        threadId: fixture.threadId,
        request: {
          manifest: fixture.manifest,
          input: { values: [2, 4] },
        },
      });
      planId = first.planId;
      expect(first).toEqual(
        expect.objectContaining({
          status: "blocked",
          nodeResults: [
            expect.objectContaining({
              errorCode: "settlement_interrupted",
              attempt: 1,
            }),
          ],
        }),
      );
      expect(
        (await fixture.services.store.listEvents(fixture.threadId)).filter(
          (event) => event.type === "workflow.javascript.completed",
        ),
      ).toHaveLength(1);
    } finally {
      finishRun.mockRestore();
      await fixture.services.shutdown();
    }
    if (!planId) throw new Error("Workflow Plan was not created");

    const reopened = await createLocalAgentRuntime({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: directSandbox(),
    });
    try {
      const recovered = await reopened.workflows.run({
        threadId: fixture.threadId,
        request: {
          manifest: fixture.manifest,
          planId,
        },
      });
      expect(recovered).toEqual(
        expect.objectContaining({
          status: "completed",
          output: { sum: 6, count: 2 },
        }),
      );
      const events = await reopened.store.listEvents(fixture.threadId);
      expect(
        events.filter(
          (event) => event.type === "workflow.javascript.completed",
        ),
      ).toHaveLength(1);
      expect(
        events.find(
          (event) =>
            event.type === "workflow.node.completed" &&
            event.payload &&
            typeof event.payload === "object" &&
            !Array.isArray(event.payload) &&
            event.payload["nodeId"] === "calculate",
        )?.payload,
      ).toEqual(expect.objectContaining({ recovered: true }));
    } finally {
      await reopened.shutdown();
    }
  }, 20_000);

  it("isolates parallel JavaScript contexts", async () => {
    const fixture = await createParallelFixture();
    try {
      const result = await fixture.services.workflows.run({
        threadId: fixture.threadId,
        request: {
          manifest: fixture.manifest,
          input: { base: 4 },
        },
      });
      expect(result).toEqual(
        expect.objectContaining({
          status: "completed",
          output: { left: 8, right: 12 },
        }),
      );
      const events = await fixture.services.store.listEvents(fixture.threadId);
      expect(
        events.filter(
          (event) => event.type === "workflow.javascript.completed",
        ),
      ).toHaveLength(2);
    } finally {
      await fixture.services.shutdown();
    }
  }, 20_000);

  it("reuses and reruns JavaScript checkpoints through Workflow experiments", async () => {
    const fixture = await createParallelFixture();
    try {
      const source = await fixture.services.workflows.run({
        threadId: fixture.threadId,
        request: {
          manifest: fixture.manifest,
          input: { base: 4 },
        },
      });
      const reusePreview = await fixture.services.workflowExperiments.preview(
        fixture.threadId,
        {
          manifest: fixture.manifest,
          planId: source.planId,
          fromNodeId: "join",
        },
      );
      expect(reusePreview).toEqual(
        expect.objectContaining({
          reusedNodeIds: ["left", "right"],
          rerunNodeIds: ["join"],
        }),
      );
      const reused = await fixture.services.workflowExperiments.run({
        sourceThreadId: fixture.threadId,
        request: {
          manifest: fixture.manifest,
          planId: source.planId,
          fromNodeId: "join",
          expectedPreviewSha256: reusePreview.previewSha256,
        },
      });
      expect(reused.result).toEqual(
        expect.objectContaining({
          status: "completed",
          output: { left: 8, right: 12 },
        }),
      );
      expect(
        (await fixture.services.store.listEvents(reused.targetThreadId)).filter(
          (event) => event.type === "workflow.javascript.completed",
        ),
      ).toHaveLength(0);

      const rerunPreview = await fixture.services.workflowExperiments.preview(
        fixture.threadId,
        {
          manifest: fixture.manifest,
          planId: source.planId,
          fromNodeId: "left",
        },
      );
      expect(rerunPreview).toEqual(
        expect.objectContaining({
          reusedNodeIds: ["right"],
          rerunNodeIds: ["left", "join"],
        }),
      );
      const rerun = await fixture.services.workflowExperiments.run({
        sourceThreadId: fixture.threadId,
        request: {
          manifest: fixture.manifest,
          planId: source.planId,
          fromNodeId: "left",
          expectedPreviewSha256: rerunPreview.previewSha256,
        },
      });
      expect(rerun.result).toEqual(
        expect.objectContaining({
          status: "completed",
          output: { left: 8, right: 12 },
        }),
      );
      expect(
        (await fixture.services.store.listEvents(rerun.targetThreadId)).filter(
          (event) => event.type === "workflow.javascript.completed",
        ),
      ).toHaveLength(1);
      await expect(
        fixture.services.workflowExperiments.preview(fixture.threadId, {
          manifest: fixture.manifest,
          planId: source.planId,
          fromNodeId: "left",
          modelOverrides: {
            left: { provider: "napier", id: "demo" },
          },
        }),
      ).rejects.toThrow("non-Agent node model");
    } finally {
      await fixture.services.shutdown();
    }
  }, 30_000);

  it("blocks policy denial and invalid output without leaking source", async () => {
    const unavailable = await createFixture({ enabled: false });
    try {
      const result = await unavailable.services.workflows.run({
        threadId: unavailable.threadId,
        request: {
          manifest: unavailable.manifest,
          input: { values: [1] },
        },
      });
      expect(result).toEqual(
        expect.objectContaining({
          status: "blocked",
          nodeResults: [
            expect.objectContaining({ errorCode: "tool_unavailable" }),
          ],
        }),
      );
    } finally {
      await unavailable.services.shutdown();
    }

    const denied = await createFixture({ policy: "observe" });
    try {
      const result = await denied.services.workflows.run({
        threadId: denied.threadId,
        request: {
          manifest: denied.manifest,
          input: { values: [1] },
        },
      });
      expect(result).toEqual(
        expect.objectContaining({
          status: "blocked",
          nodeResults: [
            expect.objectContaining({ errorCode: "policy_denied" }),
          ],
        }),
      );
      expect(
        (await denied.services.workspaceProcesses.list(denied.threadId)).some(
          (session) => session.status === "running",
        ),
      ).toBe(false);
    } finally {
      await denied.services.shutdown();
    }

    const invalid = await createFixture({
      cells: ["const PRIVATE_INVALID_SOURCE = true", "undefined"],
    });
    try {
      const result = await invalid.services.workflows.run({
        threadId: invalid.threadId,
        request: {
          manifest: invalid.manifest,
          input: { values: [1] },
        },
      });
      expect(result).toEqual(
        expect.objectContaining({
          status: "blocked",
          nodeResults: [
            expect.objectContaining({ errorCode: "output_invalid" }),
          ],
        }),
      );
      expect(
        JSON.stringify(
          await invalid.services.store.listEvents(invalid.threadId),
        ),
      ).not.toContain("PRIVATE_INVALID_SOURCE");
    } finally {
      await invalid.services.shutdown();
    }
  }, 20_000);

  it("settles timeout and caller cancellation without a live Session", async () => {
    const timedOut = await createFixture({
      cells: ["while (true) {}"],
      evaluationTimeoutMs: 2_000,
      timeoutMs: 1_000,
    });
    try {
      const result = await timedOut.services.workflows.run({
        threadId: timedOut.threadId,
        request: {
          manifest: timedOut.manifest,
          input: { values: [1] },
        },
      });
      expect(result).toEqual(
        expect.objectContaining({
          status: "blocked",
          nodeResults: [expect.objectContaining({ errorCode: "timeout" })],
        }),
      );
      expect(
        (
          await timedOut.services.workspaceProcesses.list(timedOut.threadId)
        ).some((session) => session.status === "running"),
      ).toBe(false);
    } finally {
      await timedOut.services.shutdown();
    }

    const cancelled = await createFixture({
      cells: ["while (true) {}"],
      evaluationTimeoutMs: 2_000,
      timeoutMs: 10_000,
    });
    const controller = new AbortController();
    try {
      const result = await cancelled.services.workflows.run({
        threadId: cancelled.threadId,
        request: {
          manifest: cancelled.manifest,
          input: { values: [1] },
        },
        signal: controller.signal,
        onEvent: async (event) => {
          if (event.type === "workflow.node.started") {
            setTimeout(() => controller.abort(), 25);
          }
        },
      });
      expect(result.status).toBe("cancelled");
      expect(
        (
          await cancelled.services.workspaceProcesses.list(cancelled.threadId)
        ).some((session) => session.status === "running"),
      ).toBe(false);
    } finally {
      await cancelled.services.shutdown();
    }
  }, 20_000);

  it("requires explicit retry after a transient Sandbox launch failure", async () => {
    let launchCount = 0;
    const sandbox: OsSandboxAdapter = {
      id: "flaky-workflow-javascript-test",
      async launch(request) {
        launchCount += 1;
        if (launchCount === 1) {
          throw new Error("TRANSIENT_PRIVATE_SANDBOX_FAILURE");
        }
        return directSandbox().launch(request);
      },
    };
    const fixture = await createFixture({ sandbox });
    try {
      const first = await fixture.services.workflows.run({
        threadId: fixture.threadId,
        request: {
          manifest: fixture.manifest,
          input: { values: [2, 3] },
        },
      });
      expect(first).toEqual(
        expect.objectContaining({
          status: "blocked",
          nodeResults: [
            expect.objectContaining({
              attempt: 1,
              errorCode: "javascript_failed",
            }),
          ],
        }),
      );
      const resumed = await fixture.services.workflows.run({
        threadId: fixture.threadId,
        request: {
          manifest: fixture.manifest,
          planId: first.planId,
        },
      });
      expect(resumed.status).toBe("blocked");
      const retried = await fixture.services.workflows.run({
        threadId: fixture.threadId,
        request: {
          manifest: fixture.manifest,
          planId: first.planId,
          retryBlocked: true,
        },
      });
      expect(retried).toEqual(
        expect.objectContaining({
          status: "completed",
          output: { sum: 5, count: 2 },
          nodeResults: [
            expect.objectContaining({ status: "completed", attempt: 2 }),
          ],
        }),
      );
      expect(launchCount).toBe(2);
    } finally {
      await fixture.services.shutdown();
    }
  }, 20_000);
});

interface Fixture {
  workspaceRoot: string;
  dataRoot: string;
  services: Awaited<ReturnType<typeof createLocalAgentRuntime>>;
  threadId: string;
  manifest: ExecutionPlanWorkflowManifest;
}

async function createFixture(options?: {
  policy?: "observe" | "workspace";
  enabled?: boolean;
  cells?: string[];
  evaluationTimeoutMs?: number;
  timeoutMs?: number;
  sandbox?: OsSandboxAdapter;
}): Promise<Fixture> {
  const steps: CreateExecutionPlanRequest["steps"] = [
    {
      id: "calculate",
      title: "Calculate",
      description: "Compute one typed summary.",
      verification: "Return the sum and item count.",
    },
  ];
  return createWorkflowFixture({
    steps,
    inputSchema: valuesSchema(),
    outputSchema: summarySchema(),
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
        outputSchema: summarySchema(),
        cells: options?.cells ?? [
          'const PRIVATE_CELL_SOURCE = input.workflow.values.map((value) => value); console.log("PRIVATE_CELL_CONSOLE"); PRIVATE_CELL_SOURCE.length',
          "({ sum: PRIVATE_CELL_SOURCE.reduce((total, value) => total + value, 0), count: PRIVATE_CELL_SOURCE.length })",
        ],
        evaluationTimeoutMs: options?.evaluationTimeoutMs ?? 1_000,
        timeoutMs: options?.timeoutMs ?? 10_000,
        maxAttempts: 2,
      },
    ],
    policy: options?.policy ?? "workspace",
    ...(options?.enabled !== undefined ? { enabled: options.enabled } : {}),
    sandbox: options?.sandbox,
  });
}

async function createParallelFixture(): Promise<Fixture> {
  const scalarSchema = {
    type: "object" as const,
    properties: {
      value: { type: "integer" as const, minimum: 0, maximum: 100 },
    },
    required: ["value"],
    additionalProperties: false as const,
  };
  const outputSchema = {
    type: "object" as const,
    properties: {
      left: { type: "integer" as const, minimum: 0, maximum: 100 },
      right: { type: "integer" as const, minimum: 0, maximum: 100 },
    },
    required: ["left", "right"],
    additionalProperties: false as const,
  };
  return createWorkflowFixture({
    steps: [step("left"), step("right"), step("join", ["left", "right"])],
    inputSchema: baseSchema(),
    outputSchema,
    outputNodeId: "join",
    maxConcurrency: 2,
    nodes: [
      javascriptScalarNode("left", 2, scalarSchema),
      javascriptScalarNode("right", 3, scalarSchema),
      {
        id: "join",
        type: "deterministic",
        inputBindings: {
          left: { source: "node", nodeId: "left", path: ["value"] },
          right: { source: "node", nodeId: "right", path: ["value"] },
        },
        inputSchema: {
          type: "object",
          properties: {
            left: { type: "integer", minimum: 0, maximum: 100 },
            right: { type: "integer", minimum: 0, maximum: 100 },
          },
          required: ["left", "right"],
          additionalProperties: false,
        },
        outputSchema,
        template: {
          kind: "object",
          properties: {
            left: { kind: "input", path: ["left"] },
            right: { kind: "input", path: ["right"] },
          },
        },
        timeoutMs: 5_000,
        maxAttempts: 1,
      },
    ],
    policy: "workspace",
    sandbox: directSandbox(),
  });
}

async function createWorkflowFixture(input: {
  steps: CreateExecutionPlanRequest["steps"];
  inputSchema: WorkflowObjectSchema;
  outputSchema: WorkflowObjectSchema;
  outputNodeId: string;
  nodes: Parameters<typeof defineExecutionPlanWorkflow>[0]["nodes"];
  maxConcurrency?: number;
  policy: "observe" | "workspace";
  enabled?: boolean;
  sandbox?: OsSandboxAdapter;
}): Promise<Fixture> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-workflow-javascript-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    sandbox: input.sandbox ?? directSandbox(),
  });
  const sourceThread = services.store.listThreads()[0]!;
  await services.store.updateAgent(sourceThread.agentId, {
    toolPolicy: input.policy,
    enabledTools: input.enabled === false ? [] : ["javascript_kernel"],
  });
  const plan = await services.store.createPlan(sourceThread.id, {
    objective: "Execute a typed JavaScript Workflow Session.",
    steps: input.steps,
  });
  const blueprint = await createExecutionPlanBlueprint(
    services.store,
    sourceThread.id,
    plan.id,
  );
  const targetThread = await services.store.createThread({
    title: "JavaScript Workflow target",
    agentId: sourceThread.agentId,
  });
  const manifest = defineExecutionPlanWorkflow({
    name: "JavaScript Session",
    version: 1,
    description: "Execute bounded stateful JavaScript cells.",
    blueprint,
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
    outputNodeId: input.outputNodeId,
    nodes: input.nodes,
    ...(input.maxConcurrency ? { maxConcurrency: input.maxConcurrency } : {}),
  });
  return {
    workspaceRoot,
    dataRoot,
    services,
    threadId: targetThread.id,
    manifest,
  };
}

function javascriptScalarNode(
  id: string,
  factor: number,
  outputSchema: WorkflowObjectSchema,
) {
  return {
    id,
    type: "javascript" as const,
    inputBindings: {
      workflow: { source: "workflow" as const },
      factor: { source: "literal" as const, value: factor },
    },
    inputSchema: {
      type: "object" as const,
      properties: {
        workflow: baseSchema(),
        factor: { type: "integer" as const, minimum: 1, maximum: 10 },
      },
      required: ["workflow", "factor"],
      additionalProperties: false as const,
    },
    outputSchema,
    cells: [
      "let state = input.workflow.base; state *= input.factor; ({ value: state })",
    ],
    evaluationTimeoutMs: 1_000,
    timeoutMs: 10_000,
    maxAttempts: 1,
  };
}

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

function summarySchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      sum: { type: "integer", minimum: 0, maximum: 800 },
      count: { type: "integer", minimum: 1, maximum: 8 },
    },
    required: ["sum", "count"],
    additionalProperties: false,
  };
}

function baseSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      base: { type: "integer", minimum: 0, maximum: 10 },
    },
    required: ["base"],
    additionalProperties: false,
  };
}

function step(id: string, dependsOn?: string[]) {
  return {
    id,
    title: id,
    description: `Execute ${id}.`,
    verification: `Return the typed ${id} output.`,
    ...(dependsOn ? { dependsOn } : {}),
  };
}

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-workflow-javascript-test",
    async launch(request) {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: { ...request.env },
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exit,
        async terminate() {
          if (child.exitCode === null && child.signalCode === null) {
            if (child.pid !== undefined) {
              try {
                process.kill(-child.pid, "SIGTERM");
              } catch {
                child.kill("SIGTERM");
              }
            }
          }
          await exit;
        },
      };
    },
  };
}
