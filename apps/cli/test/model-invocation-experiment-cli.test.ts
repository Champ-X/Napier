import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  createLocalAgentRuntime,
  UnsupportedSandboxAdapter,
  validateModelInvocationExperimentResultFrame,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseCliArgs,
  runCli,
  type CliIo,
  type RunCliDependencies,
} from "../src/cli.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier model invocation experiment CLI", () => {
  it("parses preview-bound single-call options", () => {
    expect(
      parseCliArgs([
        "model-experiment",
        "--workspace",
        ".",
        "--thread",
        "thread_example",
        "--run",
        "run_abcdefgh",
        "--turn-index",
        "0",
        "--model",
        "deepseek/deepseek-chat",
        "--preview",
        "--jsonl",
      ]),
    ).toEqual({
      kind: "model-experiment",
      options: {
        workspace: ".",
        threadId: "thread_example",
        sourceRunId: "run_abcdefgh",
        sourceTurnIndex: 0,
        model: { provider: "deepseek", id: "deepseek-chat" },
        timeoutMs: 10 * 60 * 1_000,
        jsonl: true,
        preview: true,
      },
    });
    expect(() =>
      parseCliArgs([
        "model-experiment",
        "--workspace",
        ".",
        "--thread",
        "thread_example",
        "--run",
        "run_abcdefgh",
        "--turn-index",
        "0",
      ]),
    ).toThrow("requires --expected-preview");
  });

  it("previews and streams one isolated provider call through JSONL", async () => {
    const fixture = await createFixture();
    const sourceServices = await createLocalAgentRuntime({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("model-experiment-source"),
    });
    const sourceProvider = fauxProvider({
      provider: "faux-model-experiment-cli",
      tokensPerSecond: 100_000,
    });
    sourceProvider.setResponses([
      fauxAssistantMessage("source CLI answer"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    sourceServices.models.registerProvider(sourceProvider.provider);
    const agent = sourceServices.store.listAgents()[0]!;
    const thread = await sourceServices.store.createThread({
      title: "CLI model invocation source",
      agentId: agent.id,
    });
    const source = await sourceServices.runtime.runPrompt({
      threadId: thread.id,
      text: "Capture one CLI provider call.",
      model: { provider: "faux-model-experiment-cli", id: "faux-1" },
    });
    await sourceServices.shutdown();

    const dependencies = runtimeDependencies();
    const previewStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "model-experiment",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--thread",
          thread.id,
          "--run",
          source.id,
          "--turn-index",
          "0",
          "--preview",
          "--jsonl",
        ],
        cliIo(fixture.root, previewStdout),
        dependencies,
      ),
    ).toBe(0);
    const preview = record(JSON.parse(previewStdout.text()))!;
    expect(preview).toEqual(
      expect.objectContaining({
        kind: "napier.model-invocation-experiment-preview",
        sourceThreadId: thread.id,
        sourceRunId: source.id,
        sourceTurnIndex: 0,
        targetExecutionMode: "model_experiment_single_call",
      }),
    );

    const executeStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "model-experiment",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--thread",
          thread.id,
          "--run",
          source.id,
          "--turn-index",
          "0",
          "--expected-preview",
          String(preview["previewSha256"]),
          "--jsonl",
        ],
        cliIo(fixture.root, executeStdout),
        dependencies,
      ),
    ).toBe(0);
    const frames = parseLines(executeStdout.text());
    expect(record(frames.at(-2))?.["type"]).toBe("snapshot");
    const result = validateModelInvocationExperimentResultFrame(frames.at(-1));
    expect(result).toEqual(
      expect.objectContaining({
        sourceThreadId: thread.id,
        sourceRunId: source.id,
        sourceTurnIndex: 0,
        status: "completed",
        experiment: expect.objectContaining({
          candidateToolCallNames: ["apply_patch"],
        }),
      }),
    );
    const eventTypes = frames.flatMap((frame) => {
      const value = record(frame);
      const event = record(value?.["event"]);
      return value?.["type"] === "event" && typeof event?.["type"] === "string"
        ? [event["type"]]
        : [];
    });
    expect(eventTypes).toContain("model.experiment.started");
    expect(eventTypes).toContain("model.experiment.compared");
    expect(eventTypes).not.toContain("tool.started");
  });
});

function runtimeDependencies(): RunCliDependencies {
  return {
    async createRuntime(options: LocalAgentRuntimeOptions) {
      const services = await createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("model-experiment-cli"),
      });
      const provider = fauxProvider({
        provider: "faux-model-experiment-cli",
        tokensPerSecond: 100_000,
      });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("apply_patch", {
            patch: "*** Begin Patch\n*** End Patch",
          }),
        ),
      ]);
      services.models.registerProvider(provider.provider);
      return services;
    },
  };
}

async function createFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-cli-model-invocation-experiment-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  return { root, workspaceRoot, dataRoot: path.join(root, "data") };
}

function cliIo(root: string, stdout: Writable): CliIo {
  return {
    cwd: root,
    env: {},
    stdout,
    stderr: new CaptureWritable(),
  };
}

function parseLines(text: string): unknown[] {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

class CaptureWritable extends Writable {
  private readonly chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}
