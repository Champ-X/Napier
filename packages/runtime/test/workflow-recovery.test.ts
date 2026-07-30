import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ExecutionPlan,
  ExecutionPlanWorkflowManifest,
  JsonValue,
  WorkflowObjectSchema,
} from "@napier/contracts";
import { EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import {
  createExecutionPlanBlueprint,
  executionPlanRequestFromBlueprint,
} from "../src/workflow-blueprints.js";
import { defineExecutionPlanWorkflow } from "../src/workflow-manifests.js";
import { ExecutionPlanWorkflowRuntime } from "../src/workflow-runtime.js";
import { workflowSchemaSha256 } from "../src/workflow-schemas.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Execution Plan Workflow recovery", () => {
  it("turns a process-interrupted Run into one explicit blocked node attempt", async () => {
    const fixture = await createFixture();
    const seeded = await seedRunningNode(fixture);
    fixture.store.close();

    const reopened = await reopen(fixture);
    expect(reopened.store.getPlan(seeded.plan.id).steps[0]).toEqual(
      expect.objectContaining({
        status: "blocked",
        runId: seeded.runId,
      }),
    );
    await expect(
      reopened.agentRuntime.resumeInterruptedRun({
        threadId: fixture.threadId,
        runId: seeded.runId,
      }),
    ).rejects.toThrow("through their Workflow Plan");

    const result = await reopened.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: seeded.plan.id,
      },
    });

    expect(result.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        attempt: 1,
        status: "blocked",
        runId: seeded.runId,
        errorCode: "run_interrupted",
      }),
    ]);
    const events = await reopened.store.listEvents(fixture.threadId);
    expect(
      events.filter((event) => event.type === "workflow.node.started"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "workflow.node.failed"),
    ).toHaveLength(1);

    await reopened.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: seeded.plan.id,
      },
    });
    expect(
      (await reopened.store.listEvents(fixture.threadId)).filter(
        (event) => event.type === "workflow.node.failed",
      ),
    ).toHaveLength(1);
    reopened.store.close();
  });

  it("blocks invalid output from a completed Run left in a running Plan step", async () => {
    const fixture = await createFixture();
    const seeded = await seedRunningNode(fixture, {
      assistantOutput: "not json",
      runStatus: "completed",
    });
    fixture.store.close();

    const reopened = await reopen(fixture);
    expect(reopened.store.getPlan(seeded.plan.id).steps[0]?.status).toBe(
      "running",
    );
    const result = await reopened.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: seeded.plan.id,
      },
    });

    expect(result.nodeResults).toEqual([
      expect.objectContaining({
        nodeId: "inspect",
        attempt: 1,
        status: "blocked",
        runId: seeded.runId,
        errorCode: "output_invalid",
      }),
    ]);
    expect(reopened.store.getPlan(seeded.plan.id).steps[0]?.status).toBe(
      "blocked",
    );
    reopened.store.close();
  });

  it("keeps the original attempt when a terminal failed Run outlives its running step", async () => {
    const fixture = await createFixture();
    const seeded = await seedRunningNode(fixture, {
      runStatus: "failed",
    });
    fixture.store.close();

    const reopened = await reopen(fixture);
    const result = await reopened.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: seeded.plan.id,
      },
    });

    expect(result.nodeResults).toEqual([
      expect.objectContaining({
        attempt: 1,
        runId: seeded.runId,
        errorCode: "run_failed",
      }),
    ]);
    reopened.store.close();
  });

  it("reconstructs a failure event if the Plan block committed first", async () => {
    const fixture = await createFixture();
    const diagnosticSha256 = sha256("Workflow node output is not strict JSON");
    const seeded = await seedRunningNode(fixture, {
      assistantOutput: "not json",
      runStatus: "completed",
      block: {
        blocker: "Workflow node failed (output_invalid).",
        evidence: `Diagnostic SHA-256: ${diagnosticSha256}`,
      },
    });
    fixture.store.close();

    const reopened = await reopen(fixture);
    const result = await reopened.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: seeded.plan.id,
      },
    });

    expect(result.nodeResults).toEqual([
      expect.objectContaining({
        attempt: 1,
        runId: seeded.runId,
        errorCode: "output_invalid",
        diagnosticSha256,
      }),
    ]);
    const events = await reopened.store.listEvents(fixture.threadId);
    expect(
      events.filter((event) => event.type === "plan.step.blocked"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "workflow.node.failed"),
    ).toHaveLength(1);
    reopened.store.close();
  });

  it("fails closed when durable node-start evidence does not match the input", async () => {
    const fixture = await createFixture();
    const seeded = await seedRunningNode(fixture, {
      assistantOutput: '{"summary":"Recovered","count":1}',
      runStatus: "completed",
      startedInputSha256: "f".repeat(64),
    });
    fixture.store.close();

    const reopened = await reopen(fixture);
    await expect(
      reopened.workflows.run({
        threadId: fixture.threadId,
        request: {
          manifest: fixture.manifest,
          planId: seeded.plan.id,
        },
      }),
    ).rejects.toThrow("start evidence mismatch");
    expect(reopened.store.getPlan(seeded.plan.id).steps[0]?.status).toBe(
      "running",
    );
    reopened.store.close();
  });

  it("does not rerun a Tool node when restart leaves only tool.started evidence", async () => {
    const fixture = await createToolFixture();
    const seeded = await seedRunningToolNode(fixture, false);
    fixture.store.close();

    const reopened = await reopen(fixture);
    const result = await reopened.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: seeded.plan.id,
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "blocked",
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            runId: seeded.runId,
            errorCode: "run_interrupted",
          }),
        ],
      }),
    );
    expect(reopened.store.listRuns(fixture.threadId)).toHaveLength(1);
    const events = await reopened.store.listEvents(fixture.threadId);
    expect(
      events.filter((event) => event.type === "tool.started"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "tool.completed"),
    ).toHaveLength(0);
    reopened.store.close();
  });

  it("settles a Tool node after restart when its bound terminal event is durable", async () => {
    const fixture = await createToolFixture();
    const seeded = await seedRunningToolNode(fixture, true);
    fixture.store.close();

    const reopened = await reopen(fixture);
    const result = await reopened.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: seeded.plan.id,
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: listFilesReceipt(),
        nodeResults: [
          expect.objectContaining({
            nodeId: "inspect",
            runId: seeded.runId,
            status: "completed",
          }),
        ],
      }),
    );
    expect(reopened.store.listRuns(fixture.threadId)).toHaveLength(1);
    const events = await reopened.store.listEvents(fixture.threadId);
    expect(
      events.filter((event) => event.type === "tool.started"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "workflow.node.completed"),
    ).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ recovered: true }),
      }),
    ]);
    reopened.store.close();
  });

  it("fails closed on a tampered terminal Tool output after restart", async () => {
    const fixture = await createToolFixture();
    const seeded = await seedRunningToolNode(fixture, true, true);
    fixture.store.close();

    const reopened = await reopen(fixture);
    await expect(
      reopened.workflows.run({
        threadId: fixture.threadId,
        request: {
          manifest: fixture.manifest,
          planId: seeded.plan.id,
        },
      }),
    ).rejects.toThrow("output evidence hash mismatch");
    expect(reopened.store.getPlan(seeded.plan.id).steps[0]?.status).toBe(
      "blocked",
    );
    expect(reopened.store.listRuns(fixture.threadId)).toHaveLength(1);
    reopened.store.close();
  });

  it("resumes a durable Approval answer after restart", async () => {
    const fixture = await createApprovalFixture();
    const runtime = new ExecutionPlanWorkflowRuntime(
      fixture.store,
      new AgentRuntime(fixture.store, new ModelRegistry()),
    );
    const waiting = await runtime.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Approve after restart." },
      },
    });
    const decision = (
      await fixture.store.listOperatorDecisions(fixture.threadId)
    )[0]!;
    fixture.store.close();

    const reopened = await reopen(fixture);
    await reopened.store.answerOperatorDecision(fixture.threadId, decision.id, {
      selectedOptionIds: ["option_1"],
      customText: "Recovered approval.",
    });
    const completed = await reopened.workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        planId: waiting.planId,
      },
    });

    expect(completed).toEqual(
      expect.objectContaining({
        status: "completed",
        output: expect.objectContaining({
          approved: true,
          decisionId: decision.id,
          customText: "Recovered approval.",
        }),
      }),
    );
    expect(reopened.store.listRuns(fixture.threadId)).toHaveLength(2);
    reopened.store.close();
  });

  it("fails closed on duplicate Approval request bindings", async () => {
    const fixture = await createApprovalFixture();
    const runtime = new ExecutionPlanWorkflowRuntime(
      fixture.store,
      new AgentRuntime(fixture.store, new ModelRegistry()),
    );
    const waiting = await runtime.run({
      threadId: fixture.threadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Reject duplicate Approval evidence." },
      },
    });
    const binding = (await fixture.store.listEvents(fixture.threadId)).find(
      (event) => event.type === "workflow.approval.requested",
    )!;
    await fixture.store.appendEvent({
      threadId: fixture.threadId,
      runId: binding.runId,
      type: binding.type,
      category: binding.category,
      visibility: binding.visibility,
      payload: structuredClone(binding.payload),
    });

    await expect(
      runtime.run({
        threadId: fixture.threadId,
        request: {
          manifest: fixture.manifest,
          planId: waiting.planId,
        },
      }),
    ).rejects.toThrow("request evidence is unavailable");
    expect(fixture.store.listRuns(fixture.threadId)).toHaveLength(1);
    fixture.store.close();
  });
});

interface RecoveryFixture {
  workspaceRoot: string;
  dataRoot: string;
  store: LocalStore;
  threadId: string;
  manifest: ExecutionPlanWorkflowManifest;
}

async function createFixture(): Promise<RecoveryFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-workflow-recovery-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({ workspaceRoot, dataRoot });
  await store.initialize();
  const sourceThread = store.listThreads()[0]!;
  const sourcePlan = await store.createPlan(sourceThread.id, {
    objective: "Inspect one typed recovery input.",
    steps: [
      {
        id: "inspect",
        title: "Inspect",
        description: "Inspect the typed recovery input.",
        verification: "Return typed inspection JSON.",
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    store,
    sourceThread.id,
    sourcePlan.id,
  );
  const thread = await store.createThread({
    title: "Workflow recovery target",
    agentId: sourceThread.agentId,
  });
  const manifest = defineExecutionPlanWorkflow({
    name: "Recovery inspection",
    version: 1,
    description: "Recover one typed Agent node.",
    blueprint,
    inputSchema: requestSchema(),
    outputSchema: inspectionSchema(),
    outputNodeId: "inspect",
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
        model: { provider: "faux-workflow-recovery", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  });
  return {
    workspaceRoot,
    dataRoot,
    store,
    threadId: thread.id,
    manifest,
  };
}

async function createToolFixture(): Promise<RecoveryFixture> {
  const fixture = await createFixture();
  fixture.manifest = defineExecutionPlanWorkflow({
    name: "Recovery inventory",
    version: 1,
    description: "Recover one typed Tool node.",
    blueprint: fixture.manifest.blueprint,
    inputSchema: requestSchema(),
    outputSchema: listFilesReceiptSchema(),
    outputNodeId: "inspect",
    nodes: [
      {
        id: "inspect",
        type: "tool",
        tool: "list_files",
        effect: "read",
        inputBindings: {
          path: { source: "literal", value: "." },
        },
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", minLength: 1, maxLength: 20 },
          },
          required: ["path"],
          additionalProperties: false,
        },
        outputSchema: listFilesReceiptSchema(),
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  });
  return fixture;
}

async function createApprovalFixture(): Promise<RecoveryFixture> {
  const fixture = await createFixture();
  const outputSchema = structuredClone(
    EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA,
  );
  fixture.manifest = defineExecutionPlanWorkflow({
    name: "Recovery Approval",
    version: 1,
    description: "Recover one durable Approval node.",
    blueprint: fixture.manifest.blueprint,
    inputSchema: requestSchema(),
    outputSchema,
    outputNodeId: "inspect",
    nodes: [
      {
        id: "inspect",
        type: "approval",
        header: "Release",
        question: "Approve this recovered Workflow?",
        approve: {
          label: "Approve",
          description: "Complete the recovered Workflow.",
        },
        reject: {
          label: "Reject",
          description: "Block the recovered Workflow.",
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
  return fixture;
}

async function seedRunningNode(
  fixture: RecoveryFixture,
  options: {
    assistantOutput?: string;
    runStatus?: "completed" | "failed";
    startedInputSha256?: string;
    block?: { blocker: string; evidence: string };
  } = {},
): Promise<{ plan: ExecutionPlan; runId: string }> {
  const input: JsonValue = { request: "Recover this Workflow." };
  const thread = fixture.store.getThread(fixture.threadId);
  const agent = fixture.store.getAgent(thread.agentId);
  const plan = await fixture.store.createPlan(
    fixture.threadId,
    executionPlanRequestFromBlueprint(fixture.manifest.blueprint),
  );
  await fixture.store.appendEvent({
    threadId: fixture.threadId,
    runId: "runctl_workflow_recovery",
    type: "workflow.started",
    category: "plan",
    visibility: "user",
    payload: {
      schemaVersion: 1,
      planId: plan.id,
      manifestSha256: fixture.manifest.contentSha256,
      blueprintSha256: fixture.manifest.blueprint.contentSha256,
      workflowVersion: fixture.manifest.version,
      nodeCount: 1,
      agentId: agent.id,
      agentRevision: agent.revision,
      input,
      inputSha256: sha256(canonicalJson(input)),
      inputSchemaSha256: workflowSchemaSha256(fixture.manifest.inputSchema),
      outputSchemaSha256: workflowSchemaSha256(fixture.manifest.outputSchema),
      outputNodeId: fixture.manifest.outputNodeId,
    },
  });
  const run = await fixture.store.createRun({
    threadId: fixture.threadId,
    agentId: thread.agentId,
    model: { provider: "faux-workflow-recovery", id: "faux-1" },
    source: "workflow",
  });
  const started = await fixture.store.transitionPlanStep(plan.id, "inspect", {
    action: "start",
    runId: run.id,
  });
  const nodeInput = { workflow: input };
  await fixture.store.appendEvent({
    threadId: fixture.threadId,
    runId: run.id,
    type: "workflow.node.started",
    category: "plan",
    visibility: "user",
    payload: {
      schemaVersion: 1,
      planId: plan.id,
      nodeId: "inspect",
      attempt: 1,
      manifestSha256: fixture.manifest.contentSha256,
      inputSha256:
        options.startedInputSha256 ?? sha256(canonicalJson(nodeInput)),
      inputSchemaSha256: workflowSchemaSha256(
        fixture.manifest.nodes[0]!.inputSchema,
      ),
      outputSchemaSha256: workflowSchemaSha256(
        fixture.manifest.nodes[0]!.outputSchema,
      ),
      planRevisionBefore: plan.revision,
      planRevisionAfter: started.revision,
      recovered: false,
    },
  });
  if (options.assistantOutput !== undefined) {
    await fixture.store.appendEvent({
      threadId: fixture.threadId,
      runId: run.id,
      type: "message.assistant",
      category: "message",
      visibility: "user",
      payload: { role: "assistant", text: options.assistantOutput },
    });
  }
  if (options.runStatus) {
    await fixture.store.finishRun(run.id, options.runStatus, {
      ...(options.runStatus === "failed"
        ? { error: "Seeded model failure." }
        : {}),
    });
  }
  if (options.block) {
    await fixture.store.transitionPlanStep(plan.id, "inspect", {
      action: "block",
      ...options.block,
    });
  }
  return { plan, runId: run.id };
}

async function seedRunningToolNode(
  fixture: RecoveryFixture,
  terminal: boolean,
  tamperedOutputSha256 = false,
): Promise<{ plan: ExecutionPlan; runId: string }> {
  const input: JsonValue = { request: "Recover this Tool Workflow." };
  const thread = fixture.store.getThread(fixture.threadId);
  const agent = fixture.store.getAgent(thread.agentId);
  const plan = await fixture.store.createPlan(
    fixture.threadId,
    executionPlanRequestFromBlueprint(fixture.manifest.blueprint),
  );
  await fixture.store.appendEvent({
    threadId: fixture.threadId,
    runId: "runctl_workflow_tool_recovery",
    type: "workflow.started",
    category: "plan",
    visibility: "user",
    payload: {
      schemaVersion: 1,
      planId: plan.id,
      manifestSha256: fixture.manifest.contentSha256,
      blueprintSha256: fixture.manifest.blueprint.contentSha256,
      workflowVersion: fixture.manifest.version,
      nodeCount: 1,
      agentId: agent.id,
      agentRevision: agent.revision,
      input,
      inputSha256: sha256(canonicalJson(input)),
      inputSchemaSha256: workflowSchemaSha256(fixture.manifest.inputSchema),
      outputSchemaSha256: workflowSchemaSha256(fixture.manifest.outputSchema),
      outputNodeId: fixture.manifest.outputNodeId,
    },
  });
  const run = await fixture.store.createRun({
    threadId: fixture.threadId,
    agentId: thread.agentId,
    agentRevision: agent.revision,
    model: agent.model,
    source: "workflow",
  });
  const started = await fixture.store.transitionPlanStep(plan.id, "inspect", {
    action: "start",
    runId: run.id,
  });
  const nodeInput = { path: "." };
  const inputSha256 = sha256(canonicalJson(nodeInput));
  await fixture.store.appendEvent({
    threadId: fixture.threadId,
    runId: run.id,
    type: "workflow.node.started",
    category: "plan",
    visibility: "user",
    payload: {
      schemaVersion: 1,
      planId: plan.id,
      nodeId: "inspect",
      nodeType: "tool",
      toolName: "list_files",
      effect: "read",
      attempt: 1,
      manifestSha256: fixture.manifest.contentSha256,
      inputSha256,
      inputSchemaSha256: workflowSchemaSha256(
        fixture.manifest.nodes[0]!.inputSchema,
      ),
      outputSchemaSha256: workflowSchemaSha256(
        fixture.manifest.nodes[0]!.outputSchema,
      ),
      planRevisionBefore: plan.revision,
      planRevisionAfter: started.revision,
      recovered: false,
    },
  });
  await fixture.store.appendEvent({
    threadId: fixture.threadId,
    runId: run.id,
    type: "tool.started",
    category: "tool",
    visibility: "user",
    payload: {
      callId: "toolcall_workflow_recovery",
      toolName: "list_files",
      status: "started",
      effect: "read",
      workflowPlanId: plan.id,
      workflowNodeId: "inspect",
      workflowAttempt: 1,
      inputSha256,
    },
  });
  if (terminal) {
    const output = listFilesReceipt();
    await fixture.store.appendEvent({
      threadId: fixture.threadId,
      runId: run.id,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "toolcall_workflow_recovery",
        toolName: "list_files",
        status: "completed",
        effect: "read",
        workflowPlanId: plan.id,
        workflowNodeId: "inspect",
        workflowAttempt: 1,
        workflowInputSha256: inputSha256,
        workflowOutput: output,
        workflowOutputSha256: tamperedOutputSha256
          ? "f".repeat(64)
          : sha256(canonicalJson(output)),
      },
    });
  }
  return { plan, runId: run.id };
}

async function reopen(fixture: RecoveryFixture): Promise<{
  store: LocalStore;
  agentRuntime: AgentRuntime;
  workflows: ExecutionPlanWorkflowRuntime;
}> {
  const store = new LocalStore({
    workspaceRoot: fixture.workspaceRoot,
    dataRoot: fixture.dataRoot,
  });
  await store.initialize();
  const agentRuntime = new AgentRuntime(store, new ModelRegistry());
  return {
    store,
    agentRuntime,
    workflows: new ExecutionPlanWorkflowRuntime(store, agentRuntime),
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

function listFilesReceipt(): JsonValue {
  return {
    count: 0,
    truncated: false,
    pathSha256: "1".repeat(64),
    entrySetSha256: "2".repeat(64),
  };
}
