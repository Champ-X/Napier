import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  validateToolInvocationExperimentResultFrame,
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

describe("Napier tool invocation experiment CLI", () => {
  it("parses preview-bound read-only call options", () => {
    expect(
      parseCliArgs([
        "tool-experiment",
        "--workspace",
        ".",
        "--thread",
        "thread_example",
        "--run",
        "run_abcdefgh",
        "--call-id",
        "call_example",
        "--preview",
        "--jsonl",
      ]),
    ).toEqual({
      kind: "tool-experiment",
      options: {
        workspace: ".",
        threadId: "thread_example",
        sourceRunId: "run_abcdefgh",
        sourceCallId: "call_example",
        timeoutMs: 10 * 60 * 1_000,
        jsonl: true,
        preview: true,
      },
    });
    expect(() =>
      parseCliArgs([
        "tool-experiment",
        "--workspace",
        ".",
        "--thread",
        "thread_example",
        "--run",
        "run_abcdefgh",
        "--call-id",
        "call_example",
      ]),
    ).toThrow("requires --expected-preview");
  });

  it("previews and streams one real read-only tool call through JSONL", async () => {
    const fixture = await createFixture();
    const previewStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "tool-experiment",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--thread",
          fixture.threadId,
          "--run",
          fixture.runId,
          "--call-id",
          fixture.callId,
          "--preview",
          "--jsonl",
        ],
        cliIo(fixture.root, previewStdout),
        runtimeDependencies(),
      ),
    ).toBe(0);
    const preview = record(JSON.parse(previewStdout.text()))!;
    expect(preview).toEqual(
      expect.objectContaining({
        kind: "napier.tool-invocation-experiment-preview",
        sourceThreadId: fixture.threadId,
        sourceRunId: fixture.runId,
        sourceCallId: fixture.callId,
        sourceToolName: "read_file",
        targetExecutionMode: "tool_experiment_read_only",
      }),
    );

    const executeStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "tool-experiment",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--thread",
          fixture.threadId,
          "--run",
          fixture.runId,
          "--call-id",
          fixture.callId,
          "--expected-preview",
          String(preview["previewSha256"]),
          "--jsonl",
        ],
        cliIo(fixture.root, executeStdout),
        runtimeDependencies(),
      ),
    ).toBe(0);
    const frames = parseLines(executeStdout.text());
    expect(record(frames.at(-2))?.["type"]).toBe("snapshot");
    const result = validateToolInvocationExperimentResultFrame(frames.at(-1));
    expect(result).toEqual(
      expect.objectContaining({
        sourceThreadId: fixture.threadId,
        sourceRunId: fixture.runId,
        sourceCallId: fixture.callId,
        status: "completed",
        experiment: expect.objectContaining({
          candidateOutput: expect.stringContaining("CLI evidence"),
          comparison: expect.objectContaining({ outputChanged: false }),
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
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "tool.experiment.started",
        "tool.started",
        "tool.completed",
        "tool.experiment.compared",
      ]),
    );
    expect(eventTypes).not.toContain("model.response");
  });
});

function runtimeDependencies(): RunCliDependencies {
  return {
    createRuntime(options: LocalAgentRuntimeOptions) {
      return createLocalAgentRuntime(options);
    },
  };
}

async function createFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
  threadId: string;
  runId: string;
  callId: string;
}> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-cli-tool-invocation-experiment-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  await writeFile(
    path.join(workspaceRoot, "evidence.txt"),
    "CLI evidence\n",
    "utf8",
  );
  const services = await createLocalAgentRuntime({ workspaceRoot, dataRoot });
  const original = services.store.listAgents()[0]!;
  const agent = await services.store.updateAgent(original.id, {
    enabledTools: ["read_file"],
  });
  const thread = await services.store.createThread({
    title: "CLI tool invocation source",
    agentId: agent.id,
  });
  const provider = fauxProvider({ provider: "faux-tool-experiment-cli" });
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("read_file", { path: "evidence.txt" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("Read complete."),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  services.models.registerProvider(provider.provider);
  const run = await services.runtime.runPrompt({
    threadId: thread.id,
    text: "Read CLI evidence.",
    model: { provider: "faux-tool-experiment-cli", id: "faux-1" },
  });
  const capture = (await services.store.listEvents(thread.id)).find(
    (event) => event.type === "context.tool_invocation",
  )!;
  const callId = (capture.payload as { callId: string }).callId;
  await services.shutdown();
  return {
    root,
    workspaceRoot,
    dataRoot,
    threadId: thread.id,
    runId: run.id,
    callId,
  };
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
