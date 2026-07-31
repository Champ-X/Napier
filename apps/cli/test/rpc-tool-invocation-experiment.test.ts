import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PassThrough, Writable } from "node:stream";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  createLocalAgentRuntime,
  sha256,
  type LocalAgentRuntimeServices,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { runNapierRpcServer } from "../src/rpc-server.js";

const temporaryRoots: string[] = [];
const openServices: LocalAgentRuntimeServices[] = [];

afterEach(async () => {
  for (const services of openServices.splice(0)) {
    await services.shutdown();
  }
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier tool invocation experiment RPC", () => {
  it("previews, executes, rejects stale confirmation, and cancels a real call", async () => {
    const fixture = await createFixture();
    const input = new PassThrough();
    const output = new CaptureWritable();
    const server = runNapierRpcServer({
      agents: fixture.services.embeddedAgents,
      workflows: fixture.services.embeddedWorkflows,
      experiments: fixture.services.workflowExperiments,
      agentExperiments: fixture.services.agentMessageExperiments,
      modelExperiments: fixture.services.modelInvocationExperiments,
      toolExperiments: fixture.services.toolInvocationExperiments,
      input,
      output,
      serverVersion: "test",
    });

    send(input, { jsonrpc: "2.0", id: "init", method: "initialize" });
    expect(await output.waitForId("init")).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          capabilities: expect.objectContaining({
            toolInvocationExperimentPreview: true,
            toolInvocationExperimentRun: true,
          }),
        }),
      }),
    );

    const params = {
      sourceThreadId: fixture.threadId,
      sourceRunId: fixture.runId,
      sourceCallId: fixture.callId,
    };
    send(input, {
      jsonrpc: "2.0",
      id: "preview",
      method: "napier/tool/experiment/preview",
      params,
    });
    const preview = record((await output.waitForId("preview"))["result"])!;
    expect(preview).toEqual(
      expect.objectContaining({
        sourceToolName: "sqlite_query",
        targetExecutionMode: "tool_experiment_read_only",
        previewSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );

    send(input, {
      jsonrpc: "2.0",
      id: "stale",
      method: "napier/tool/experiment/run",
      params: { ...params, expectedPreviewSha256: "0".repeat(64) },
    });
    expect(await output.waitForId("stale")).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: -32007,
          message: "Tool invocation experiment conflict",
        }),
      }),
    );

    send(input, {
      jsonrpc: "2.0",
      id: "execute",
      method: "napier/tool/experiment/run",
      params: {
        ...params,
        expectedPreviewSha256: preview["previewSha256"],
      },
    });
    const execution = record((await output.waitForId("execute"))["result"])!;
    expect(execution).toEqual(
      expect.objectContaining({
        sourceThreadId: fixture.threadId,
        sourceRunId: fixture.runId,
        sourceCallId: fixture.callId,
        targetThreadId: expect.stringMatching(/^thread_/u),
        targetRunId: expect.stringMatching(/^run_/u),
        status: "completed",
        experiment: expect.objectContaining({
          candidateOutput: expect.stringContaining("total"),
        }),
      }),
    );
    expect(eventTypes(output.messages(), "execute")).toEqual(
      expect.arrayContaining([
        "tool.experiment.started",
        "tool.started",
        "tool.completed",
        "tool.experiment.compared",
      ]),
    );
    expect(eventTypes(output.messages(), "execute")).not.toContain(
      "model.response",
    );

    send(input, {
      jsonrpc: "2.0",
      id: "cancel",
      method: "napier/tool/experiment/run",
      params: {
        ...params,
        expectedPreviewSha256: preview["previewSha256"],
      },
    });
    await output.waitFor(
      (message) =>
        message["method"] === "napier/event" &&
        record(message["params"])?.["requestId"] === "cancel" &&
        record(record(message["params"])?.["event"])?.["type"] ===
          "tool.started",
    );
    send(input, {
      jsonrpc: "2.0",
      method: "$/cancelRequest",
      params: { id: "cancel" },
    });
    expect(await output.waitForId("cancel")).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          status: "cancelled",
          experiment: expect.objectContaining({ status: "cancelled" }),
        }),
      }),
    );

    send(input, { jsonrpc: "2.0", id: "shutdown", method: "shutdown" });
    await output.waitForId("shutdown");
    send(input, { jsonrpc: "2.0", method: "exit" });
    input.end();
    expect(await server).toBe(0);
  });
});

async function createFixture(): Promise<{
  services: LocalAgentRuntimeServices;
  threadId: string;
  runId: string;
  callId: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-rpc-tool-call-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const databasePath = path.join(workspaceRoot, "evidence.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE evidence (id INTEGER PRIMARY KEY)");
  database.close();
  const databaseSha256 = sha256(await readFile(databasePath));
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  openServices.push(services);
  const original = services.store.listAgents()[0]!;
  const agent = await services.store.updateAgent(original.id, {
    enabledTools: ["sqlite_query"],
  });
  const provider = fauxProvider({ provider: "faux-rpc-tool-experiment" });
  provider.setResponses([
    fauxAssistantMessage(
      fauxToolCall("sqlite_query", {
        action: "query",
        path: "evidence.sqlite",
        databaseSha256,
        sql: "WITH RECURSIVE cnt(x) AS (VALUES(1) UNION ALL SELECT x + 1 FROM cnt WHERE x < 250000) SELECT sum(x) AS total FROM cnt",
        maxRows: 5,
        timeoutMs: 5_000,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("RPC read complete."),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  services.models.registerProvider(provider.provider);
  const thread = await services.store.createThread({
    title: "RPC tool invocation source",
    agentId: agent.id,
  });
  const run = await services.runtime.runPrompt({
    threadId: thread.id,
    text: "Read RPC evidence.",
    model: { provider: "faux-rpc-tool-experiment", id: "faux-1" },
  });
  const capture = (await services.store.listEvents(thread.id)).find(
    (event) => event.type === "context.tool_invocation",
  )!;
  return {
    services,
    threadId: thread.id,
    runId: run.id,
    callId: (capture.payload as { callId: string }).callId,
  };
}

function send(input: PassThrough, message: unknown): void {
  input.write(`${JSON.stringify(message)}\n`);
}

function eventTypes(
  messages: Array<Record<string, unknown>>,
  requestId: string,
): string[] {
  return messages.flatMap((message) => {
    if (
      message["method"] !== "napier/event" ||
      record(message["params"])?.["requestId"] !== requestId
    ) {
      return [];
    }
    const type = record(record(message["params"])?.["event"])?.["type"];
    return typeof type === "string" ? [type] : [];
  });
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

  messages(): Array<Record<string, unknown>> {
    return this.chunks
      .join("")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  waitForId(id: string | number): Promise<Record<string, unknown>> {
    return this.waitFor((message) => message["id"] === id);
  }

  async waitFor(
    predicate: (message: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const match = this.messages().find(predicate);
      if (match) return match;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Timed out waiting for tool invocation RPC output");
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
