import { PassThrough, Writable } from "node:stream";

import type { RunEvent, RunRecord } from "@napier/contracts";
import type {
  EmbeddedAgentExecution,
  EmbeddedAgentService,
  EmbeddedWorkflowService,
  ResumeEmbeddedAgentOptions,
  RunEmbeddedAgentOptions,
} from "@napier/runtime";
import { describe, expect, it } from "vitest";

import { MAX_RPC_ACTIVE_REQUESTS } from "../src/rpc-protocol.js";
import { runNapierRpcServer } from "../src/rpc-server.js";

describe("Napier JSON-RPC server", () => {
  it("enforces initialization, method, and shutdown lifecycle", async () => {
    let calls = 0;
    const harness = new RpcHarness(
      agentService({
        async run() {
          calls += 1;
          return execution("thread_rpc", "run_rpc_lifecycle", "completed");
        },
      }),
    );
    const server = harness.start();
    harness.send({
      jsonrpc: "2.0",
      id: "early",
      method: "napier/agent/run",
      params: { prompt: "Too early" },
    });
    expect(await harness.waitForId("early")).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: -32002 }),
      }),
    );
    await harness.initialize();
    harness.send({
      jsonrpc: "2.0",
      id: "unknown",
      method: "napier/unknown",
    });
    expect(await harness.waitForId("unknown")).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: -32601 }),
      }),
    );
    harness.send({
      jsonrpc: "2.0",
      id: "duplicate-init",
      method: "initialize",
    });
    expect(await harness.waitForId("duplicate-init")).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: -32600 }),
      }),
    );
    harness.send({
      jsonrpc: "2.0",
      id: "shutdown",
      method: "shutdown",
    });
    await harness.waitForId("shutdown");
    harness.send({
      jsonrpc: "2.0",
      id: "late",
      method: "napier/agent/run",
      params: { prompt: "Too late" },
    });
    expect(await harness.waitForId("late")).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: -32000 }),
      }),
    );
    expect(calls).toBe(0);
    harness.send({ jsonrpc: "2.0", method: "exit" });
    harness.input.end();
    expect(await server).toBe(0);
  });

  it("runs and resumes Agents with request-bound Ledger event notifications", async () => {
    const calls: string[] = [];
    const agents = agentService({
      async run(options) {
        calls.push(`run:${options.prompt}`);
        await options.onEvent?.(runEvent("run_rpc_first", "run.started"));
        return execution("thread_rpc", "run_rpc_first", "completed", "first");
      },
      async resume(options) {
        calls.push(`resume:${options.threadId}`);
        await options.onEvent?.(
          runEvent("run_rpc_recovery", "run.recovery.started"),
        );
        return execution(
          options.threadId,
          "run_rpc_recovery",
          "completed",
          "resumed",
        );
      },
    });
    const harness = new RpcHarness(agents);
    const server = harness.start();

    harness.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "rpc-test" } },
    });
    expect(await harness.waitForId(1)).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          protocolVersion: 1,
          capabilities: expect.objectContaining({
            agentRun: true,
            agentResume: true,
          }),
        }),
      }),
    );

    harness.send({
      jsonrpc: "2.0",
      id: "run-request",
      method: "napier/agent/run",
      params: {
        prompt: "Run through RPC.",
        model: { provider: "napier", id: "demo" },
      },
    });
    expect(
      await harness.waitFor(
        (message) =>
          message["method"] === "napier/event" &&
          record(message["params"])?.["requestId"] === "run-request",
      ),
    ).toEqual(
      expect.objectContaining({
        params: expect.objectContaining({
          event: expect.objectContaining({ type: "run.started" }),
          eventSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    expect(await harness.waitForId("run-request")).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          threadId: "thread_rpc",
          runId: "run_rpc_first",
          status: "completed",
          assistantText: "first",
        }),
      }),
    );

    harness.send({
      jsonrpc: "2.0",
      id: "resume-request",
      method: "napier/agent/resume",
      params: {
        threadId: "thread_rpc",
        runId: "run_abcdefgh",
      },
    });
    expect(await harness.waitForId("resume-request")).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          threadId: "thread_rpc",
          runId: "run_rpc_recovery",
          status: "completed",
        }),
      }),
    );
    expect(calls).toEqual(["run:Run through RPC.", "resume:thread_rpc"]);
    await harness.shutdown();
    expect(await server).toBe(0);
  });

  it("cancels an active request and settles it before shutdown", async () => {
    let observedAbort = false;
    const agents = agentService({
      async run(options) {
        await options.onEvent?.(runEvent("run_rpc_cancel", "run.started"));
        await waitForAbort(options.signal!);
        observedAbort = options.signal!.aborted;
        return execution("thread_rpc_cancel", "run_rpc_cancel", "cancelled");
      },
    });
    const harness = new RpcHarness(agents);
    const server = harness.start();
    await harness.initialize();
    harness.send({
      jsonrpc: "2.0",
      id: 2,
      method: "napier/agent/run",
      params: { prompt: "Cancel this request." },
    });
    await harness.waitFor(
      (message) =>
        message["method"] === "napier/event" &&
        record(message["params"])?.["requestId"] === 2,
    );
    harness.send({
      jsonrpc: "2.0",
      method: "$/cancelRequest",
      params: { id: 2 },
    });
    expect(await harness.waitForId(2)).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: -32800,
          message: "Request cancelled",
        }),
      }),
    );
    expect(observedAbort).toBe(true);
    await harness.shutdown();
    expect(await server).toBe(0);
  });

  it("rejects invalid params and bounds concurrent requests", async () => {
    let calls = 0;
    const agents = agentService({
      async run(options) {
        calls += 1;
        await waitForAbort(options.signal!);
        return execution(
          `thread_rpc_${String(calls)}`,
          `run_rpc_active_${String(calls)}`,
          "cancelled",
        );
      },
    });
    const harness = new RpcHarness(agents);
    const server = harness.start();
    await harness.initialize();
    harness.send({
      jsonrpc: "2.0",
      id: "invalid",
      method: "napier/agent/run",
      params: { prompt: "x", secret: "PRIVATE_PARAM" },
    });
    expect(await harness.waitForId("invalid")).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: -32602,
          message: "Invalid params",
          data: expect.objectContaining({
            diagnosticSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
        }),
      }),
    );
    expect(harness.output.text()).not.toContain("PRIVATE_PARAM");

    for (let index = 0; index < MAX_RPC_ACTIVE_REQUESTS; index += 1) {
      harness.send({
        jsonrpc: "2.0",
        id: index,
        method: "napier/agent/run",
        params: { prompt: `Run ${String(index)}` },
      });
    }
    harness.send({
      jsonrpc: "2.0",
      id: "overflow",
      method: "napier/agent/run",
      params: { prompt: "Overflow" },
    });
    expect(await harness.waitForId("overflow")).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: -32001,
          message: "Server busy",
        }),
      }),
    );
    expect(calls).toBe(MAX_RPC_ACTIVE_REQUESTS);
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
    await harness.shutdown();
    expect(await server).toBe(0);
  });

  it("cancels active work when the client closes stdin", async () => {
    let aborted = false;
    const agents = agentService({
      async run(options) {
        await options.onEvent?.(runEvent("run_rpc_eof", "run.started"));
        await waitForAbort(options.signal!);
        aborted = true;
        return execution("thread_rpc_eof", "run_rpc_eof", "cancelled");
      },
    });
    const harness = new RpcHarness(agents);
    const server = harness.start();
    await harness.initialize();
    harness.send({
      jsonrpc: "2.0",
      id: "eof",
      method: "napier/agent/run",
      params: { prompt: "Wait for EOF." },
    });
    await harness.waitFor(
      (message) =>
        message["method"] === "napier/event" &&
        record(message["params"])?.["requestId"] === "eof",
    );
    harness.input.end();
    expect(await server).toBe(0);
    expect(aborted).toBe(true);
    expect(await harness.waitForId("eof")).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: -32800 }),
      }),
    );
  });

  it("exits when the parent aborts while stdin remains open", async () => {
    const controller = new AbortController();
    const harness = new RpcHarness(agentService({}), controller.signal);
    const server = harness.start();
    await harness.initialize();

    controller.abort();

    expect(await server).toBe(0);
  });
});

function agentService(overrides: {
  run?: (options: RunEmbeddedAgentOptions) => Promise<EmbeddedAgentExecution>;
  resume?: (
    options: ResumeEmbeddedAgentOptions,
  ) => Promise<EmbeddedAgentExecution>;
}): Pick<EmbeddedAgentService, "run" | "resume"> {
  return {
    run:
      overrides.run ??
      (async () => execution("thread_rpc", "run_rpc_default", "completed")),
    resume:
      overrides.resume ??
      (async (options) =>
        execution(options.threadId, "run_rpc_resume", "completed")),
  };
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

function unusedExperimentService() {
  const unexpected = async (): Promise<never> => {
    throw new Error("Unexpected Workflow experiment RPC call");
  };
  return { preview: unexpected, run: unexpected };
}

function execution(
  threadId: string,
  runId: string,
  status: RunRecord["status"],
  assistantText?: string,
): EmbeddedAgentExecution {
  return {
    threadId,
    run: {
      id: runId,
      threadId,
      status,
    } as RunRecord,
    ...(assistantText !== undefined ? { assistantText } : {}),
  };
}

function runEvent(runId: string, type: string): RunEvent {
  return {
    id: `event_${runId}_${type.replaceAll(".", "_")}`,
    threadId: "thread_rpc",
    runId,
    seq: 1,
    type,
    category: "lifecycle",
    visibility: "debug",
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

class RpcHarness {
  readonly input = new PassThrough();
  readonly output = new CaptureWritable();
  private server: Promise<number> | undefined;

  constructor(
    private readonly agents: Pick<EmbeddedAgentService, "run" | "resume">,
    private readonly signal?: AbortSignal,
    private readonly workflows = unusedWorkflowService(),
  ) {}

  start(): Promise<number> {
    this.server = runNapierRpcServer({
      agents: this.agents,
      workflows: this.workflows,
      experiments: unusedExperimentService(),
      input: this.input,
      output: this.output,
      serverVersion: "test",
      ...(this.signal ? { signal: this.signal } : {}),
    });
    return this.server;
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

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
