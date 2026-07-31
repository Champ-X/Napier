import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  createLocalAgentRuntime,
  UnsupportedSandboxAdapter,
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

describe("Napier model invocation experiment RPC", () => {
  it("previews, executes, rejects stale confirmation, and cancels one real call", async () => {
    const fixture = await createFixture();
    const input = new PassThrough();
    const output = new CaptureWritable();
    const server = runNapierRpcServer({
      agents: fixture.services.embeddedAgents,
      workflows: fixture.services.embeddedWorkflows,
      experiments: fixture.services.workflowExperiments,
      agentExperiments: fixture.services.agentMessageExperiments,
      modelExperiments: fixture.services.modelInvocationExperiments,
      input,
      output,
      serverVersion: "test",
    });

    send(input, {
      jsonrpc: "2.0",
      id: "initialize",
      method: "initialize",
    });
    expect(await output.waitForId("initialize")).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          capabilities: expect.objectContaining({
            modelInvocationExperimentPreview: true,
            modelInvocationExperimentRun: true,
          }),
        }),
      }),
    );

    send(input, {
      jsonrpc: "2.0",
      id: "preview",
      method: "napier/model/experiment/preview",
      params: {
        sourceThreadId: fixture.sourceThreadId,
        sourceRunId: fixture.sourceRunId,
        sourceTurnIndex: 0,
      },
    });
    const preview = record((await output.waitForId("preview"))["result"])!;
    expect(preview).toEqual(
      expect.objectContaining({
        sourceThreadId: fixture.sourceThreadId,
        sourceRunId: fixture.sourceRunId,
        sourceTurnIndex: 0,
        targetExecutionMode: "model_experiment_single_call",
        previewSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );

    send(input, {
      jsonrpc: "2.0",
      id: "stale",
      method: "napier/model/experiment/run",
      params: {
        sourceThreadId: fixture.sourceThreadId,
        sourceRunId: fixture.sourceRunId,
        sourceTurnIndex: 0,
        expectedPreviewSha256: "0".repeat(64),
      },
    });
    expect(await output.waitForId("stale")).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: -32006,
          message: "Model invocation experiment conflict",
        }),
      }),
    );

    fixture.provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("apply_patch", {
          patch: "*** Begin Patch\n*** End Patch",
        }),
      ),
    ]);
    send(input, {
      jsonrpc: "2.0",
      id: "execute",
      method: "napier/model/experiment/run",
      params: {
        sourceThreadId: fixture.sourceThreadId,
        sourceRunId: fixture.sourceRunId,
        sourceTurnIndex: 0,
        expectedPreviewSha256: preview["previewSha256"],
      },
    });
    const execution = record((await output.waitForId("execute"))["result"])!;
    expect(execution).toEqual(
      expect.objectContaining({
        sourceThreadId: fixture.sourceThreadId,
        sourceRunId: fixture.sourceRunId,
        sourceTurnIndex: 0,
        targetThreadId: expect.stringMatching(/^thread_/u),
        targetRunId: expect.stringMatching(/^run_/u),
        status: "completed",
        previewSha256: preview["previewSha256"],
        experiment: expect.objectContaining({
          candidateToolCallNames: ["apply_patch"],
        }),
      }),
    );
    expect(eventTypes(output.messages(), "execute")).toEqual(
      expect.arrayContaining([
        "model.experiment.started",
        "model.experiment.compared",
      ]),
    );
    expect(eventTypes(output.messages(), "execute")).not.toContain(
      "tool.started",
    );

    fixture.provider.setResponses([
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return fauxAssistantMessage("late candidate");
      },
    ]);
    send(input, {
      jsonrpc: "2.0",
      id: "cancel",
      method: "napier/model/experiment/run",
      params: {
        sourceThreadId: fixture.sourceThreadId,
        sourceRunId: fixture.sourceRunId,
        sourceTurnIndex: 0,
        expectedPreviewSha256: preview["previewSha256"],
      },
    });
    await output.waitFor(
      (message) =>
        message["method"] === "napier/event" &&
        record(message["params"])?.["requestId"] === "cancel" &&
        record(record(message["params"])?.["event"])?.["type"] ===
          "model.experiment.started",
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
  provider: ReturnType<typeof fauxProvider>;
  sourceThreadId: string;
  sourceRunId: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-rpc-model-call-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
    sandbox: new UnsupportedSandboxAdapter("rpc-model-experiment"),
  });
  openServices.push(services);
  const provider = fauxProvider({
    provider: "faux-rpc-model-experiment",
    tokensPerSecond: 100_000,
  });
  provider.setResponses([
    fauxAssistantMessage("source RPC model answer"),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  services.models.registerProvider(provider.provider);
  const agent = services.store.listAgents()[0]!;
  const thread = await services.store.createThread({
    title: "RPC model invocation source",
    agentId: agent.id,
  });
  const run = await services.runtime.runPrompt({
    threadId: thread.id,
    text: "Capture one provider call for RPC.",
    model: { provider: "faux-rpc-model-experiment", id: "faux-1" },
  });
  return {
    services,
    provider,
    sourceThreadId: thread.id,
    sourceRunId: run.id,
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
    throw new Error("Timed out waiting for model invocation RPC output");
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
