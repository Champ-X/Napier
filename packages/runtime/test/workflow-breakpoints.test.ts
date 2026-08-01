import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  CreateExecutionPlanRequest,
  ExecutionPlanWorkflowManifest,
  RunEvent,
  WorkflowObjectSchema,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { LocalStore } from "../src/store.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";
import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";
import { defineExecutionPlanWorkflow } from "../src/workflow-manifests.js";
import { validateExecuteExecutionPlanWorkflowRequest } from "../src/workflow-protocol.js";
import { ExecutionPlanWorkflowRuntime } from "../src/workflow-runtime.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Workflow breakpoints", () => {
  it("pauses before a write and continues only after explicit consent across restart", async () => {
    const fixture = await createFixture();
    const streamed: RunEvent[] = [];

    const paused = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Create the breakpoint deliverable." },
        breakBeforeNodeIds: ["write"],
      },
      onEvent: (event) => {
        streamed.push(event);
      },
    });

    expect(paused).toEqual(
      expect.objectContaining({
        status: "paused",
        resumed: false,
        breakpoint: expect.objectContaining({
          nodeId: "write",
          breakpointIndex: 0,
          breakpointCount: 1,
          reachedEventSeq: expect.any(Number),
          bindingContextSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
        nodeResults: [
          expect.objectContaining({
            nodeId: "prepare",
            status: "completed",
          }),
        ],
      }),
    );
    await expect(
      readFile(path.join(fixture.workspaceRoot, "breakpoint.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(fixture.store.listRuns(fixture.threadId)).toHaveLength(1);
    expect(streamed.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "workflow.breakpoint.reached",
        "workflow.paused",
      ]),
    );
    expect(
      streamed.some(
        (event) =>
          event.type === "tool.started" || event.type === "tool.completed",
      ),
    ).toBe(false);

    const stillPaused = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: paused.planId,
      },
    });
    expect(stillPaused).toEqual(
      expect.objectContaining({
        status: "paused",
        resumed: true,
        breakpoint: paused.breakpoint,
      }),
    );
    expect(
      (await fixture.store.listEvents(fixture.threadId)).filter(
        (event) => event.type === "workflow.breakpoint.reached",
      ),
    ).toHaveLength(1);
    expect(fixture.store.listRuns(fixture.threadId)).toHaveLength(1);

    fixture.store.close();
    const reopened = await reopenFixture(fixture);
    const completed = await reopened.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: paused.planId,
        continueBreakpoint: true,
      },
    });

    expect(completed.status).toBe("completed");
    expect(completed.breakpoint).toBeUndefined();
    await expect(
      readFile(path.join(fixture.workspaceRoot, "breakpoint.txt"), "utf8"),
    ).resolves.toBe("created after explicit breakpoint continuation\n");
    expect(reopened.store.listRuns(fixture.threadId)).toHaveLength(2);
    expect(reopened.store.getPlan(paused.planId).artifacts).toEqual([
      expect.objectContaining({ status: "verified" }),
    ]);
    expect(
      (await reopened.store.listEvents(fixture.threadId)).map(
        (event) => event.type,
      ),
    ).toEqual(
      expect.arrayContaining([
        "workflow.breakpoint.continued",
        "tool.started",
        "tool.completed",
        "plan.artifact.verified",
        "workflow.completed",
      ]),
    );
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(reopened.store, fixture.threadId),
      ).status,
    ).toBe("valid");
    reopened.store.close();
  });

  it("turns cancellation after durable reach into a recoverable pause", async () => {
    const fixture = await createFixture();
    const controller = new AbortController();
    const cancelled = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Cancel at the first breakpoint." },
        breakBeforeNodeIds: ["prepare"],
      },
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "workflow.breakpoint.reached") controller.abort();
      },
    });

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.nodeResults).toEqual([]);
    expect(fixture.store.listRuns(fixture.threadId)).toEqual([]);
    const paused = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: cancelled.planId,
      },
    });
    expect(paused).toEqual(
      expect.objectContaining({
        status: "paused",
        breakpoint: expect.objectContaining({ nodeId: "prepare" }),
      }),
    );
    fixture.store.close();
  });

  it("does not repeat consent after durable continuation is cancelled", async () => {
    const fixture = await createFixture();
    const paused = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Cancel after breakpoint continuation." },
        breakBeforeNodeIds: ["write"],
      },
    });
    const controller = new AbortController();
    const cancelled = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: paused.planId,
        continueBreakpoint: true,
      },
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "workflow.breakpoint.continued") controller.abort();
      },
    });

    expect(cancelled.status).toBe("cancelled");
    await expect(
      readFile(path.join(fixture.workspaceRoot, "breakpoint.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const completed = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: paused.planId,
      },
    });
    expect(completed.status).toBe("completed");
    await expect(
      readFile(path.join(fixture.workspaceRoot, "breakpoint.txt"), "utf8"),
    ).resolves.toBe("created after explicit breakpoint continuation\n");
    expect(
      (await fixture.store.listEvents(fixture.threadId)).filter(
        (event) => event.type === "workflow.breakpoint.continued",
      ),
    ).toHaveLength(1);
    fixture.store.close();
  });

  it("advances one declared breakpoint at a time in Manifest order", async () => {
    const fixture = await createFixture();
    const first = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Pause at both nodes." },
        breakBeforeNodeIds: ["write", "prepare"],
      },
    });
    expect(first).toEqual(
      expect.objectContaining({
        status: "paused",
        breakpoint: expect.objectContaining({
          nodeId: "prepare",
          breakpointIndex: 0,
          breakpointCount: 2,
        }),
      }),
    );

    const second = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: first.planId,
        continueBreakpoint: true,
      },
    });
    expect(second).toEqual(
      expect.objectContaining({
        status: "paused",
        breakpoint: expect.objectContaining({
          nodeId: "write",
          breakpointIndex: 1,
          breakpointCount: 2,
        }),
        nodeResults: [
          expect.objectContaining({
            nodeId: "prepare",
            status: "completed",
          }),
        ],
      }),
    );
    await expect(
      readFile(path.join(fixture.workspaceRoot, "breakpoint.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const completed = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: first.planId,
        continueBreakpoint: true,
      },
    });
    expect(completed.status).toBe("completed");
    fixture.store.close();
  });

  it("releases one parallel node and recovers it before the next hold", async () => {
    const fixture = await createFixture({ parallel: true });
    const first = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Step through both parallel branches." },
        breakBeforeNodeIds: ["left", "right"],
      },
    });
    expect(first).toEqual(
      expect.objectContaining({
        status: "paused",
        breakpoint: expect.objectContaining({ nodeId: "left" }),
      }),
    );

    const controller = new AbortController();
    const cancelled = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: first.planId,
        continueBreakpoint: true,
      },
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "workflow.breakpoint.continued") controller.abort();
      },
    });
    expect(cancelled.status).toBe("cancelled");
    expect(fixture.store.getPlan(first.planId).steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "left", status: "ready" }),
        expect.objectContaining({ id: "right", status: "ready" }),
      ]),
    );

    fixture.store.close();
    const reopened = await reopenFixture(fixture);
    const second = await reopened.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: first.planId,
      },
    });
    expect(second).toEqual(
      expect.objectContaining({
        status: "paused",
        breakpoint: expect.objectContaining({ nodeId: "right" }),
        nodeResults: expect.arrayContaining([
          expect.objectContaining({ nodeId: "left", status: "completed" }),
        ]),
      }),
    );
    const steppedEvents = await reopened.store.listEvents(fixture.threadId);
    expect(
      steppedEvents.filter(
        (event) =>
          event.type === "workflow.deterministic.completed" &&
          record(event.payload)?.["nodeId"] === "left",
      ),
    ).toHaveLength(1);
    expect(
      steppedEvents.some(
        (event) =>
          event.type === "workflow.deterministic.completed" &&
          record(event.payload)?.["nodeId"] === "right",
      ),
    ).toBe(false);

    const completed = await reopened.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: first.planId,
        continueBreakpoint: true,
      },
    });
    expect(completed).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { content: "join" },
      }),
    );
    reopened.store.close();
  });

  it("isolates breakpoint state across concurrent Threads", async () => {
    const fixture = await createFixture();
    const sourceThread = fixture.store.listThreads()[0]!;
    const secondThread = await fixture.store.createThread({
      title: "Second breakpoint target",
      agentId: sourceThread.agentId,
    });

    const [first, second] = await Promise.all([
      fixture.workflows.run({
        threadId: fixture.threadId,
        request: {
          manifest: fixture.manifest,
          input: { request: "Pause first." },
          breakBeforeNodeIds: ["prepare"],
        },
      }),
      fixture.workflows.run({
        threadId: secondThread.id,
        request: {
          manifest: fixture.manifest,
          input: { request: "Pause second." },
          breakBeforeNodeIds: ["prepare"],
        },
      }),
    ]);

    expect([first.status, second.status]).toEqual(["paused", "paused"]);
    expect(first.planId).not.toBe(second.planId);
    expect(fixture.store.listRuns(fixture.threadId)).toEqual([]);
    expect(fixture.store.listRuns(secondThread.id)).toEqual([]);
    fixture.store.close();
  });

  it("fails closed on forged continuation evidence before the write", async () => {
    const fixture = await createFixture();
    const paused = await fixture.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Reject forged continuation." },
        breakBeforeNodeIds: ["write"],
      },
    });
    await fixture.store.appendEvent({
      threadId: fixture.threadId,
      runId: "runctl_forged_breakpoint",
      type: "workflow.breakpoint.continued",
      category: "plan",
      visibility: "user",
      payload: {
        schemaVersion: 1,
        planId: paused.planId,
        manifestSha256: fixture.manifest.contentSha256,
        nodeId: "write",
        breakpointIndex: 0,
        breakpointCount: 1,
        bindingContextSha256: "f".repeat(64),
        planRevision: fixture.store.getPlan(paused.planId).revision,
        reachedEventSeq: paused.breakpoint!.reachedEventSeq,
      },
    });

    await expect(
      fixture.workflows.run({
        threadId: fixture.threadId,
        request: {
          manifest: fixture.manifest,
          planId: paused.planId,
          continueBreakpoint: true,
        },
      }),
    ).rejects.toThrow("breakpoint evidence");
    await expect(
      readFile(path.join(fixture.workspaceRoot, "breakpoint.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(fixture.store.listRuns(fixture.threadId)).toHaveLength(1);
    fixture.store.close();
  });

  it("validates breakpoint targets and mutually exclusive recovery actions", async () => {
    const fixture = await createFixture();
    expect(() =>
      validateExecuteExecutionPlanWorkflowRequest({
        manifest: fixture.manifest,
        input: { request: "Unknown breakpoint." },
        breakBeforeNodeIds: ["unknown"],
      }),
    ).toThrow("not in the Manifest");
    expect(() =>
      validateExecuteExecutionPlanWorkflowRequest({
        manifest: fixture.manifest,
        input: { request: "Duplicate breakpoint." },
        breakBeforeNodeIds: ["write", "write"],
      }),
    ).toThrow("must be unique");
    expect(() =>
      validateExecuteExecutionPlanWorkflowRequest({
        manifest: fixture.manifest,
        planId: "plan_abcdefghijklmnopqrst",
        retryBlocked: true,
        continueBreakpoint: true,
      }),
    ).toThrow("resume request is invalid");
    fixture.store.close();
  });
});

interface BreakpointFixture {
  root: string;
  workspaceRoot: string;
  dataRoot: string;
  store: LocalStore;
  workflows: ExecutionPlanWorkflowRuntime;
  threadId: string;
  manifest: ExecutionPlanWorkflowManifest;
}

async function createFixture(options?: {
  parallel?: boolean;
}): Promise<BreakpointFixture> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-workflow-breakpoint-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({ workspaceRoot, dataRoot });
  await store.initialize();
  const sourceThread = store.listThreads()[0]!;
  const planRequest = options?.parallel
    ? parallelBreakpointPlan()
    : breakpointPlan();
  const sourcePlan = await store.createPlan(sourceThread.id, planRequest);
  const blueprint = await createExecutionPlanBlueprint(
    store,
    sourceThread.id,
    sourcePlan.id,
  );
  const thread = await store.createThread({
    title: "Workflow breakpoint target",
    agentId: sourceThread.agentId,
  });
  await store.updateAgent(thread.agentId, { toolPolicy: "workspace" });
  const manifest = options?.parallel
    ? defineExecutionPlanWorkflow({
        name: "Parallel breakpoint steps",
        version: 1,
        description: "Release exactly one parallel deterministic node.",
        blueprint,
        inputSchema: requestSchema(),
        outputSchema: preparedSchema(),
        outputNodeId: "join",
        maxConcurrency: 2,
        nodes: ["prepare", "left", "right", "join"].map((id) => ({
          id,
          type: "deterministic" as const,
          inputBindings: {
            workflow: { source: "workflow" as const },
          },
          inputSchema: {
            type: "object" as const,
            properties: { workflow: requestSchema() },
            required: ["workflow"],
            additionalProperties: false,
          },
          outputSchema: preparedSchema(),
          template: {
            kind: "object" as const,
            properties: {
              content: { kind: "literal" as const, value: id },
            },
          },
          timeoutMs: 5_000,
          maxAttempts: 1,
        })),
      })
    : defineExecutionPlanWorkflow({
        name: "Breakpoint write",
        version: 1,
        description: "Pause before one policy-checked workspace write.",
        blueprint,
        inputSchema: requestSchema(),
        outputSchema: workspacePatchReceiptSchema(),
        outputNodeId: "write",
        nodes: [
          {
            id: "prepare",
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
            outputSchema: preparedSchema(),
            template: {
              kind: "object",
              properties: {
                content: {
                  kind: "literal",
                  value: "created after explicit breakpoint continuation\n",
                },
              },
            },
            timeoutMs: 5_000,
            maxAttempts: 1,
          },
          {
            id: "write",
            type: "tool",
            tool: "apply_patch",
            effect: "write",
            inputBindings: {
              operation: { source: "literal", value: "create" },
              path: { source: "literal", value: "breakpoint.txt" },
              expectedSha256: { source: "literal", value: null },
              content: {
                source: "node",
                nodeId: "prepare",
                path: ["content"],
              },
            },
            inputSchema: workspacePatchInputSchema(),
            outputSchema: workspacePatchReceiptSchema(),
            timeoutMs: 5_000,
            maxAttempts: 1,
          },
        ],
      });
  const agentRuntime = new AgentRuntime(store, new ModelRegistry());
  return {
    root,
    workspaceRoot,
    dataRoot,
    store,
    workflows: new ExecutionPlanWorkflowRuntime(store, agentRuntime),
    threadId: thread.id,
    manifest,
  };
}

async function reopenFixture(
  fixture: BreakpointFixture,
): Promise<Pick<BreakpointFixture, "store" | "workflows">> {
  const store = new LocalStore({
    workspaceRoot: fixture.workspaceRoot,
    dataRoot: fixture.dataRoot,
  });
  await store.initialize();
  return {
    store,
    workflows: new ExecutionPlanWorkflowRuntime(
      store,
      new AgentRuntime(store, new ModelRegistry()),
    ),
  };
}

function breakpointPlan(): CreateExecutionPlanRequest {
  return {
    objective: "Create a file only after explicit breakpoint continuation.",
    steps: [
      {
        id: "prepare",
        title: "Prepare",
        description: "Prepare the exact file content.",
        verification: "Return one typed content object.",
      },
      {
        id: "write",
        title: "Write",
        description: "Create the declared workspace file.",
        verification: "Return the policy-checked patch receipt.",
        dependsOn: ["prepare"],
      },
    ],
    artifacts: [
      {
        id: "deliverable",
        path: "breakpoint.txt",
        kind: "file",
        description: "The file created after breakpoint continuation.",
      },
    ],
  };
}

function parallelBreakpointPlan(): CreateExecutionPlanRequest {
  return {
    objective: "Advance parallel Workflow branches one node at a time.",
    steps: [
      {
        id: "prepare",
        title: "Prepare",
        description: "Prepare both branches.",
        verification: "Return typed preparation.",
      },
      {
        id: "left",
        title: "Left",
        description: "Execute the left branch.",
        verification: "Return typed left output.",
        dependsOn: ["prepare"],
      },
      {
        id: "right",
        title: "Right",
        description: "Execute the right branch.",
        verification: "Return typed right output.",
        dependsOn: ["prepare"],
      },
      {
        id: "join",
        title: "Join",
        description: "Join both branches.",
        verification: "Return typed join output.",
        dependsOn: ["left", "right"],
      },
    ],
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

function preparedSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      content: { type: "string", minLength: 1, maxLength: 500 },
    },
    required: ["content"],
    additionalProperties: false,
  };
}

function workspacePatchInputSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["create"] },
      path: { type: "string", minLength: 1, maxLength: 200 },
      expectedSha256: { type: "null" },
      content: { type: "string", minLength: 1, maxLength: 500 },
    },
    required: ["operation", "path", "expectedSha256", "content"],
    additionalProperties: false,
  };
}

function workspacePatchReceiptSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["napier.workspace-patch"] },
      schemaVersion: { type: "integer", minimum: 1, maximum: 1 },
      pathSha256: { type: "string", minLength: 64, maxLength: 64 },
      operation: { type: "string", enum: ["create"] },
      beforeSha256: { type: "null" },
      afterSha256: { type: "string", minLength: 64, maxLength: 64 },
      beforeBytes: { type: "integer", minimum: 0 },
      afterBytes: { type: "integer", minimum: 0 },
      editCount: { type: "integer", minimum: 0 },
      resultSha256: { type: "string", minLength: 64, maxLength: 64 },
    },
    required: [
      "kind",
      "schemaVersion",
      "pathSha256",
      "operation",
      "beforeSha256",
      "afterSha256",
      "beforeBytes",
      "afterBytes",
      "editCount",
      "resultSha256",
    ],
    additionalProperties: false,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
