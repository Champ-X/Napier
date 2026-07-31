import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";

import type {
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowResult,
  JsonValue,
  RunEvent,
  RunRecord,
} from "@napier/contracts";
import type {
  EmbeddedAgentExecution,
  EmbeddedAgentService,
  EmbeddedWorkflowExecution,
  EmbeddedWorkflowService,
  ExecutionPlanWorkflowExperimentRuntime,
} from "@napier/runtime";
import {
  WorkflowExperimentConfirmationRequiredError,
  WorkflowExperimentPreviewChangedError,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { MAX_RPC_ACTIVE_REQUESTS } from "../src/rpc-protocol.js";
import { runNapierRpcServer } from "../src/rpc-server.js";
import { defineRpcWorkflowManifest } from "./rpc-workflow-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier Workflow JSON-RPC server", () => {
  it("runs and resumes typed Workflows with request-bound events", async () => {
    const fixture = await createFixture("execution");
    const manifest = await defineRpcWorkflowManifest(fixture);
    const calls: string[] = [];
    const workflows: Pick<
      EmbeddedWorkflowService,
      "run" | "resume" | "answerAndResume"
    > = {
      async run(options) {
        calls.push(`run:${String(record(options.input)?.["text"])}`);
        await options.onEvent?.(
          workflowEvent("thread_rpc_workflow", "workflow.started"),
        );
        return workflowExecution(
          "thread_rpc_workflow",
          "plan_rpc_workflow",
          false,
          { message: "RPC Workflow result" },
        );
      },
      async resume(options) {
        calls.push(`resume:${options.planId}`);
        await options.onEvent?.(
          workflowEvent(options.threadId, "workflow.resumed"),
        );
        return workflowExecution(options.threadId, options.planId, true, {
          message: "RPC Workflow result",
        });
      },
      async answerAndResume() {
        throw new Error("Unexpected Workflow Approval answer");
      },
    };
    const harness = new RpcWorkflowHarness(unusedAgents(), workflows);
    const server = harness.start();
    await harness.initialize();
    expect(await harness.waitForId("initialize")).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          capabilities: expect.objectContaining({
            workflowRun: true,
            workflowResume: true,
            workflowApprovalAnswer: true,
          }),
        }),
      }),
    );

    harness.send({
      jsonrpc: "2.0",
      id: "workflow-run",
      method: "napier/workflow/run",
      params: {
        manifest,
        input: { text: "Typed RPC delivery" },
        title: "RPC Workflow",
      },
    });
    expect(
      await harness.waitFor(
        (message) =>
          message["method"] === "napier/event" &&
          record(message["params"])?.["requestId"] === "workflow-run",
      ),
    ).toEqual(
      expect.objectContaining({
        params: expect.objectContaining({
          event: expect.objectContaining({ type: "workflow.started" }),
          eventSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    expect(await harness.waitForId("workflow-run")).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          threadId: "thread_rpc_workflow",
          planId: "plan_rpc_workflow",
          status: "completed",
          output: { message: "RPC Workflow result" },
          result: expect.objectContaining({ resumed: false }),
        }),
      }),
    );

    harness.send({
      jsonrpc: "2.0",
      id: "workflow-resume",
      method: "napier/workflow/resume",
      params: {
        manifest,
        threadId: "thread_rpc_workflow",
        planId: "plan_rpc_workflow",
      },
    });
    expect(await harness.waitForId("workflow-resume")).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          status: "completed",
          result: expect.objectContaining({ resumed: true }),
        }),
      }),
    );

    harness.send({
      jsonrpc: "2.0",
      id: "workflow-invalid",
      method: "napier/workflow/run",
      params: {
        manifest,
        input: { text: "" },
      },
    });
    expect(await harness.waitForId("workflow-invalid")).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: -32602 }),
      }),
    );
    expect(calls).toEqual([
      "run:Typed RPC delivery",
      "resume:plan_rpc_workflow",
    ]);
    await harness.shutdown();
    expect(await server).toBe(0);
  });

  it("shares admission across Agent and Workflow calls and cancels all", async () => {
    const fixture = await createFixture("admission");
    const manifest = await defineRpcWorkflowManifest(fixture);
    let agentCalls = 0;
    let workflowCalls = 0;
    let aborts = 0;
    const agents: Pick<EmbeddedAgentService, "run" | "resume"> = {
      async run(options) {
        agentCalls += 1;
        await waitForAbort(options.signal!);
        aborts += 1;
        return agentExecution(`thread_rpc_agent_${String(agentCalls)}`);
      },
      async resume() {
        throw new Error("Unexpected Agent resume");
      },
    };
    const workflows: Pick<
      EmbeddedWorkflowService,
      "run" | "resume" | "answerAndResume"
    > = {
      async run(options) {
        workflowCalls += 1;
        await waitForAbort(options.signal!);
        aborts += 1;
        return workflowExecution(
          `thread_rpc_workflow_${String(workflowCalls)}`,
          `plan_rpc_workflow_${String(workflowCalls)}`,
          false,
          undefined,
          "cancelled",
        );
      },
      async answerAndResume() {
        throw new Error("Unexpected Workflow Approval answer");
      },
      async resume() {
        throw new Error("Unexpected Workflow resume");
      },
    };
    const harness = new RpcWorkflowHarness(agents, workflows);
    const server = harness.start();
    await harness.initialize();

    for (let index = 0; index < MAX_RPC_ACTIVE_REQUESTS; index += 1) {
      harness.send(
        index % 2 === 0
          ? {
              jsonrpc: "2.0",
              id: index,
              method: "napier/agent/run",
              params: { prompt: `Agent ${String(index)}` },
            }
          : {
              jsonrpc: "2.0",
              id: index,
              method: "napier/workflow/run",
              params: {
                manifest,
                input: { text: `Workflow ${String(index)}` },
              },
            },
      );
    }
    harness.send({
      jsonrpc: "2.0",
      id: "overflow",
      method: "napier/workflow/run",
      params: { manifest, input: { text: "Overflow" } },
    });
    expect(await harness.waitForId("overflow")).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: -32001 }),
      }),
    );
    expect({ agentCalls, workflowCalls }).toEqual({
      agentCalls: 2,
      workflowCalls: 2,
    });

    for (let index = 0; index < MAX_RPC_ACTIVE_REQUESTS; index += 1) {
      harness.send({
        jsonrpc: "2.0",
        method: "$/cancelRequest",
        params: { id: index },
      });
    }
    for (let index = 0; index < MAX_RPC_ACTIVE_REQUESTS; index += 1) {
      expect(await harness.waitForId(index)).toEqual(
        expect.objectContaining({
          error: expect.objectContaining({ code: -32800 }),
        }),
      );
    }
    expect(aborts).toBe(MAX_RPC_ACTIVE_REQUESTS);
    await harness.shutdown();
    expect(await server).toBe(0);
  });

  it("maps stale experiment previews and cancels experiment execution", async () => {
    const fixture = await createFixture("experiment-control");
    const manifest = await defineRpcWorkflowManifest(fixture);
    let mode: "stale" | "confirmation" | "cancel" = "stale";
    let runCalls = 0;
    const experiments: Pick<
      ExecutionPlanWorkflowExperimentRuntime,
      "preview" | "run"
    > = {
      async preview() {
        throw new Error("Unexpected Workflow experiment preview");
      },
      async run(options) {
        runCalls += 1;
        if (mode === "stale") {
          throw new WorkflowExperimentPreviewChangedError();
        }
        if (mode === "confirmation") {
          throw new WorkflowExperimentConfirmationRequiredError({
            previewSha256: "a".repeat(64),
          } as ExecutionPlanWorkflowExperimentPreview);
        }
        await waitForAbort(options.signal!);
        throw new Error("Workflow experiment cancelled");
      },
    };
    const harness = new RpcWorkflowHarness(
      unusedAgents(),
      unusedWorkflowService(),
      experiments,
    );
    const server = harness.start();
    await harness.initialize();
    const params = {
      sourceThreadId: "thread_example",
      manifest,
      planId: "plan_abcdefgh",
      fromNodeId: "deliver",
      expectedPreviewSha256: "a".repeat(64),
    };
    harness.send({
      jsonrpc: "2.0",
      id: "experiment-stale",
      method: "napier/workflow/experiment/run",
      params,
    });
    expect(await harness.waitForId("experiment-stale")).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: -32004,
          message: "Workflow experiment conflict",
        }),
      }),
    );

    mode = "confirmation";
    harness.send({
      jsonrpc: "2.0",
      id: "experiment-confirmation",
      method: "napier/workflow/experiment/run",
      params,
    });
    expect(await harness.waitForId("experiment-confirmation")).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: -32004,
          message: "Workflow experiment conflict",
        }),
      }),
    );
    expect(harness.output.text()).not.toContain(
      "explicit confirmation of current side-effect evidence",
    );
    expect(harness.output.text()).not.toContain(
      "preview changed before execution",
    );

    mode = "cancel";
    harness.send({
      jsonrpc: "2.0",
      id: "experiment-cancel",
      method: "napier/workflow/experiment/run",
      params,
    });
    harness.send({
      jsonrpc: "2.0",
      method: "$/cancelRequest",
      params: { id: "experiment-cancel" },
    });
    expect(await harness.waitForId("experiment-cancel")).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: -32800 }),
      }),
    );
    expect(runCalls).toBe(3);
    await harness.shutdown();
    expect(await server).toBe(0);
  });
});

function unusedAgents(): Pick<EmbeddedAgentService, "run" | "resume"> {
  const unexpected = async (): Promise<never> => {
    throw new Error("Unexpected Agent RPC call");
  };
  return { run: unexpected, resume: unexpected };
}

function unusedWorkflowService(): Pick<
  EmbeddedWorkflowService,
  "run" | "resume" | "answerAndResume"
> {
  const unexpected = async (): Promise<never> => {
    throw new Error("Unexpected Workflow RPC call");
  };
  return {
    run: unexpected,
    resume: unexpected,
    answerAndResume: unexpected,
  };
}

function agentExecution(threadId: string): EmbeddedAgentExecution {
  return {
    threadId,
    run: {
      id: `run_${threadId.slice(-8).padStart(8, "a")}`,
      threadId,
      status: "cancelled",
    } as RunRecord,
  };
}

function workflowExecution(
  threadId: string,
  planId: string,
  resumed: boolean,
  output?: JsonValue,
  status: ExecutionPlanWorkflowResult["status"] = "completed",
): EmbeddedWorkflowExecution {
  const result: ExecutionPlanWorkflowResult = {
    kind: "napier.execution-plan-workflow-result",
    schemaVersion: 1,
    threadId,
    planId,
    manifestSha256: "a".repeat(64),
    blueprintSha256: "b".repeat(64),
    status,
    resumed,
    nodeResults: [],
    ...(output !== undefined ? { output, outputSha256: "c".repeat(64) } : {}),
    resultSha256: "d".repeat(64),
  };
  return { threadId, result };
}

function workflowEvent(threadId: string, type: string): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId,
    runId: "runctl_rpc_workflow",
    seq: 1,
    type,
    category: "plan",
    visibility: "user",
    createdAt: "2026-07-31T00:00:00.000Z",
    payload: { status: "running" },
  };
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

function unusedExperimentService(): Pick<
  ExecutionPlanWorkflowExperimentRuntime,
  "preview" | "run"
> {
  const unexpected = async (): Promise<never> => {
    throw new Error("Unexpected Workflow experiment RPC call");
  };
  return { preview: unexpected, run: unexpected };
}

class RpcWorkflowHarness {
  readonly input = new PassThrough();
  readonly output = new CaptureWritable();

  constructor(
    private readonly agents: Pick<EmbeddedAgentService, "run" | "resume">,
    private readonly workflows: Pick<
      EmbeddedWorkflowService,
      "run" | "resume" | "answerAndResume"
    >,
    private readonly experiments: Pick<
      ExecutionPlanWorkflowExperimentRuntime,
      "preview" | "run"
    > = unusedExperimentService(),
  ) {}

  start(): Promise<number> {
    return runNapierRpcServer({
      agents: this.agents,
      workflows: this.workflows,
      experiments: this.experiments,
      agentExperiments: unusedExperimentService(),
      modelExperiments: unusedExperimentService(),
      input: this.input,
      output: this.output,
      serverVersion: "test",
    });
  }

  send(message: unknown): void {
    this.input.write(`${JSON.stringify(message)}\n`);
  }

  async initialize(): Promise<void> {
    this.send({
      jsonrpc: "2.0",
      id: "initialize",
      method: "initialize",
    });
    await this.waitForId("initialize");
  }

  async shutdown(): Promise<void> {
    this.send({
      jsonrpc: "2.0",
      id: "shutdown",
      method: "shutdown",
    });
    await this.waitForId("shutdown");
    this.send({ jsonrpc: "2.0", method: "exit" });
    this.input.end();
  }

  waitForId(id: string | number): Promise<Record<string, unknown>> {
    return this.waitFor((message) => message["id"] === id);
  }

  async waitFor(
    predicate: (message: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const match = this.output.messages().find(predicate);
      if (match) return match;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for RPC output: ${this.output.text()}`);
  }
}

class CaptureWritable extends Writable {
  private readonly chunks: string[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString("utf8"));
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }

  messages(): Array<Record<string, unknown>> {
    return this.text()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

async function createFixture(label: string) {
  const root = await mkdtemp(path.join(tmpdir(), `napier-rpc-${label}-`));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  return { workspaceRoot, dataRoot };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
