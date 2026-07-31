import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import {
  createLocalAgentRuntime,
  UnsupportedSandboxAdapter,
  validateAgentMessageExperimentResultFrame,
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

describe("Napier Agent message experiment CLI", () => {
  it("parses preview-bound experiment options", () => {
    expect(
      parseCliArgs([
        "experiment",
        "--workspace",
        ".",
        "--thread",
        "thread_example",
        "--run",
        "run_abcdefgh",
        "--message-seq",
        "12",
        "--model",
        "napier/demo",
        "--preview",
        "--jsonl",
      ]),
    ).toEqual({
      kind: "experiment",
      options: {
        workspace: ".",
        threadId: "thread_example",
        sourceRunId: "run_abcdefgh",
        sourceMessageSeq: 12,
        model: { provider: "napier", id: "demo" },
        timeoutMs: 10 * 60 * 1_000,
        jsonl: true,
        preview: true,
      },
    });
    expect(() =>
      parseCliArgs([
        "experiment",
        "--workspace",
        ".",
        "--thread",
        "thread_example",
        "--run",
        "run_abcdefgh",
        "--message-seq",
        "12",
      ]),
    ).toThrow("requires --expected-preview");
    expect(() =>
      parseCliArgs([
        "experiment",
        "--workspace",
        ".",
        "--thread",
        "thread_example",
        "--run",
        "run_abcdefgh",
        "--message-seq",
        "12",
        "--preview",
        "--expected-preview",
        "a".repeat(64),
      ]),
    ).toThrow("--preview cannot include");
  });

  it("previews and streams an ordered real target through JSONL", async () => {
    const fixture = await createFixture();
    const dependencies = runtimeDependencies();
    const sourceStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "run",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--prompt",
          "Record one CLI message checkpoint.",
          "--model",
          "napier/demo",
          "--jsonl",
        ],
        cliIo(fixture.root, sourceStdout),
        dependencies,
      ),
    ).toBe(0);
    const sourceFrames = parseLines(sourceStdout.text());
    const sourceMessage = sourceFrames
      .flatMap((frame) =>
        record(frame)?.["type"] === "event" ? [record(frame)!["event"]] : [],
      )
      .map(record)
      .find((event) => event?.["type"] === "message.user")!;
    const sourceThreadId = String(sourceMessage["threadId"]);
    const sourceRunId = String(sourceMessage["runId"]);
    const sourceMessageSeq = Number(sourceMessage["seq"]);

    const previewStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "experiment",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--thread",
          sourceThreadId,
          "--run",
          sourceRunId,
          "--message-seq",
          String(sourceMessageSeq),
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
        kind: "napier.agent-message-experiment-preview",
        sourceThreadId,
        sourceRunId,
        sourceMessageSeq,
        targetExecutionMode: "agent_experiment_read_only",
      }),
    );

    const experimentStdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "experiment",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--thread",
          sourceThreadId,
          "--run",
          sourceRunId,
          "--message-seq",
          String(sourceMessageSeq),
          "--expected-preview",
          String(preview["previewSha256"]),
          "--jsonl",
        ],
        cliIo(fixture.root, experimentStdout),
        dependencies,
      ),
    ).toBe(0);
    const frames = parseLines(experimentStdout.text());
    expect(record(frames.at(-2))?.["type"]).toBe("snapshot");
    const result = validateAgentMessageExperimentResultFrame(frames.at(-1));
    expect(result).toEqual(
      expect.objectContaining({
        sourceThreadId,
        sourceRunId,
        sourceMessageSeq,
        status: "completed",
        experiment: expect.objectContaining({
          comparison: expect.objectContaining({
            target: expect.objectContaining({
              executionMode: "agent_experiment_read_only",
            }),
          }),
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
        "agent.experiment.started",
        "message.assistant",
        "agent.experiment.compared",
      ]),
    );
  });
});

function runtimeDependencies(): RunCliDependencies {
  return {
    async createRuntime(options: LocalAgentRuntimeOptions) {
      return createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("cli-agent-message-experiment"),
      });
    },
  };
}

async function createFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-cli-agent-message-experiment-"),
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
