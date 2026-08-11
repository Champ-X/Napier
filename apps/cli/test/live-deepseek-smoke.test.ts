import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import type {
  ExecutionPlanWorkflowExperimentResultFrame,
  ExecutionPlanWorkflowResultFrame,
  StreamFrame,
  WorkflowObjectSchema,
} from "@napier/contracts";
import {
  createExecutionPlanBlueprint,
  createLocalAgentRuntime,
  defineExecutionPlanWorkflow,
  validateExecutionPlanWorkflowExperimentResultFrame,
  validateExecutionPlanWorkflowResultFrame,
} from "@napier/runtime";
import { spawn as spawnTerminal } from "@lydell/node-pty";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";

const describeLive =
  process.env["NAPIER_LIVE_CLI_DEEPSEEK_SMOKE"] === "1"
    ? describe
    : describe.skip;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describeLive("live DeepSeek CLI smoke", () => {
  it("runs a low-cost real model through the JSONL CLI", async () => {
    const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();
    if (!apiKey) {
      throw new Error(
        "Set DEEPSEEK_API_KEY before running the live CLI smoke test",
      );
    }
    const modelId =
      process.env["DEEPSEEK_MODEL"]?.trim() || "deepseek-v4-flash";
    const root = await mkdtemp(path.join(tmpdir(), "napier-live-cli-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();

    const code = await runCli(
      [
        "run",
        "--workspace",
        workspaceRoot,
        "--data-root",
        dataRoot,
        "--prompt",
        "Reply with exactly NAPIER_CLI_LIVE_OK.",
        "--model",
        `deepseek/${modelId}`,
        "--credential-env",
        "DEEPSEEK_API_KEY",
        "--jsonl",
      ],
      {
        cwd: root,
        env: { DEEPSEEK_API_KEY: apiKey },
        stdout,
        stderr,
      },
    );

    expect(code).toBe(0);
    expect(stderr.text()).toBe("");
    const frames = stdout
      .text()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as StreamFrame);
    expect(frames.at(-1)).toEqual(
      expect.objectContaining({ type: "done", status: "completed" }),
    );
    expect(stdout.text()).not.toContain(apiKey);
    const inspection = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: { DEEPSEEK_API_KEY: apiKey },
    });
    try {
      expect(inspection.store.listCredentialReferences()).toEqual([
        expect.objectContaining({
          providerId: "deepseek",
          source: {
            type: "environment",
            variable: "DEEPSEEK_API_KEY",
          },
          availability: "available",
        }),
      ]);
    } finally {
      await inspection.shutdown();
    }
  }, 60_000);

  it("bootstraps a clean-state interactive Chat through the built CLI", async () => {
    const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();
    if (!apiKey) {
      throw new Error(
        "Set DEEPSEEK_API_KEY before running the live CLI smoke test",
      );
    }
    const modelId =
      process.env["DEEPSEEK_MODEL"]?.trim() || "deepseek-v4-flash";
    const root = await mkdtemp(path.join(tmpdir(), "napier-live-chat-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const entrypoint = path.resolve(import.meta.dirname, "../dist/index.js");
    let output = "";
    let exited = false;
    const terminal = spawnTerminal(
      process.execPath,
      [
        entrypoint,
        "chat",
        "--workspace",
        workspaceRoot,
        "--data-root",
        dataRoot,
        "--model",
        `deepseek/${modelId}`,
        "--credential-env",
        "DEEPSEEK_API_KEY",
      ],
      {
        name: "xterm-256color",
        cols: 100,
        rows: 30,
        cwd: root,
        env: {
          ...terminalEnvironment(),
          DEEPSEEK_API_KEY: apiKey,
        },
      },
    );
    const dataSubscription = terminal.onData((data) => {
      output += data;
    });
    const exit = new Promise<number>((resolve) => {
      terminal.onExit(({ exitCode }) => {
        exited = true;
        resolve(exitCode);
      });
    });
    try {
      await expect
        .poll(() => output, { timeout: 10_000 })
        .toContain("Napier chat ready");
      terminal.write("Reply with exactly NAPIER_CHAT_LIVE_OK.\r");
      await expect
        .poll(() => output.match(/NAPIER_CHAT_LIVE_OK/gu)?.length ?? 0, {
          timeout: 60_000,
        })
        .toBeGreaterThanOrEqual(2);
      terminal.write("/exit\r");
      expect(await exit).toBe(0);
    } finally {
      dataSubscription.dispose();
      if (!exited) terminal.kill();
    }

    expect(output).not.toContain(apiKey);
    const inspection = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: { DEEPSEEK_API_KEY: apiKey },
    });
    try {
      const threads = inspection.store.listThreads();
      expect(inspection.store.listCredentialReferences()).toEqual([
        expect.objectContaining({
          providerId: "deepseek",
          source: {
            type: "environment",
            variable: "DEEPSEEK_API_KEY",
          },
          availability: "available",
        }),
      ]);
      expect(
        threads
          .flatMap((thread) => inspection.store.listRuns(thread.id))
          .filter((run) => run.source === "user"),
      ).toEqual([expect.objectContaining({ status: "completed" })]);
      const events = (
        await Promise.all(
          threads.map((thread) => inspection.store.listEvents(thread.id)),
        )
      ).flat();
      expect(
        events
          .filter((event) => event.type === "message.assistant")
          .map((event) => event.payload),
      ).toContainEqual(
        expect.objectContaining({ text: "NAPIER_CHAT_LIVE_OK" }),
      );
    } finally {
      await inspection.shutdown();
    }
  }, 90_000);

  it("resumes an interrupted Run through the real model", async () => {
    const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();
    if (!apiKey) {
      throw new Error(
        "Set DEEPSEEK_API_KEY before running the live CLI smoke test",
      );
    }
    const modelId =
      process.env["DEEPSEEK_MODEL"]?.trim() || "deepseek-v4-flash";
    const root = await mkdtemp(path.join(tmpdir(), "napier-live-cli-resume-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const setup = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: { DEEPSEEK_API_KEY: apiKey },
    });
    await setup.store.createCredentialReference({
      providerId: "deepseek",
      label: "CLI resume live smoke env",
      source: { type: "environment", variable: "DEEPSEEK_API_KEY" },
    });
    const agent = setup.store.listAgents()[0]!;
    const thread = await setup.store.createThread({
      title: "CLI live resume",
      agentId: agent.id,
    });
    const interrupted = await setup.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "deepseek", id: modelId },
    });
    await setup.store.appendEvent({
      threadId: thread.id,
      runId: interrupted.id,
      type: "message.user",
      category: "message",
      visibility: "user",
      payload: {
        role: "user",
        text: "After recovery reply with exactly NAPIER_CLI_RESUME_LIVE_OK.",
      },
    });
    await setup.shutdown();
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();

    const code = await runCli(
      [
        "resume",
        "--workspace",
        workspaceRoot,
        "--data-root",
        dataRoot,
        "--thread",
        thread.id,
        "--run",
        interrupted.id,
        "--model",
        `deepseek/${modelId}`,
        "--jsonl",
      ],
      {
        cwd: root,
        env: { DEEPSEEK_API_KEY: apiKey },
        stdout,
        stderr,
      },
    );

    expect(code).toBe(0);
    expect(stderr.text()).toBe("");
    const frames = stdout
      .text()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as StreamFrame);
    const done = frames.at(-1);
    const snapshot = frames.at(-2);
    expect(done).toEqual(
      expect.objectContaining({ type: "done", status: "completed" }),
    );
    expect(snapshot?.type).toBe("snapshot");
    if (snapshot?.type !== "snapshot" || done?.type !== "done") return;
    expect(snapshot.detail.runs.find((run) => run.id === done.runId)).toEqual(
      expect.objectContaining({
        parentRunId: interrupted.id,
        source: "recovery",
      }),
    );
    expect(stdout.text()).toContain("NAPIER_CLI_RESUME_LIVE_OK");
    expect(stdout.text()).not.toContain(apiKey);
  }, 60_000);

  it("executes and checkpoint-reruns a typed Workflow through the real model", async () => {
    const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();
    if (!apiKey) {
      throw new Error(
        "Set DEEPSEEK_API_KEY before running the live CLI smoke test",
      );
    }
    const modelId =
      process.env["DEEPSEEK_MODEL"]?.trim() || "deepseek-v4-flash";
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-live-cli-workflow-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const setup = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: { DEEPSEEK_API_KEY: apiKey },
    });
    await setup.store.createCredentialReference({
      providerId: "deepseek",
      label: "CLI Workflow live smoke env",
      source: { type: "environment", variable: "DEEPSEEK_API_KEY" },
    });
    const sourceThread = setup.store.listThreads()[0]!;
    const sourcePlan = await setup.store.createPlan(sourceThread.id, {
      objective: "Return one typed Workflow smoke token.",
      steps: [
        {
          id: "answer",
          title: "Answer",
          description:
            "Return the JSON string NAPIER_WORKFLOW_LIVE_OK exactly.",
          verification:
            "The output equals the required token and passes its schema.",
        },
      ],
    });
    const blueprint = await createExecutionPlanBlueprint(
      setup.store,
      sourceThread.id,
      sourcePlan.id,
    );
    const inputSchema = liveWorkflowInputSchema();
    const outputSchema = {
      type: "string" as const,
      enum: ["NAPIER_WORKFLOW_LIVE_OK"],
    };
    const manifest = defineExecutionPlanWorkflow({
      name: "Live typed answer",
      version: 1,
      description: "Exercise one real typed Workflow Agent node.",
      blueprint,
      inputSchema,
      outputSchema,
      outputNodeId: "answer",
      nodes: [
        {
          id: "answer",
          type: "agent",
          inputBindings: { workflow: { source: "workflow" } },
          inputSchema: {
            type: "object",
            properties: { workflow: inputSchema },
            required: ["workflow"],
            additionalProperties: false,
          },
          outputSchema,
          model: { provider: "deepseek", id: modelId },
          timeoutMs: 30_000,
          maxAttempts: 1,
        },
      ],
    });
    await writeFile(
      path.join(workspaceRoot, "workflow.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    await setup.shutdown();
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();

    const code = await runCli(
      [
        "workflow",
        "--workspace",
        workspaceRoot,
        "--data-root",
        dataRoot,
        "--manifest",
        "workflow.json",
        "--input-json",
        '{"request":"Return the required token."}',
        "--jsonl",
      ],
      {
        cwd: root,
        env: { DEEPSEEK_API_KEY: apiKey },
        stdout,
        stderr,
      },
    );

    expect(code).toBe(0);
    expect(stderr.text()).toBe("");
    const frames = stdout
      .text()
      .split("\n")
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as StreamFrame | ExecutionPlanWorkflowResultFrame,
      );
    const sourceWorkflow = validateExecutionPlanWorkflowResultFrame(
      frames.at(-1),
    );
    expect(sourceWorkflow.result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: "NAPIER_WORKFLOW_LIVE_OK",
      }),
    );
    const experimentStdout = new CaptureWritable();
    const experimentStderr = new CaptureWritable();
    const experimentCode = await runCli(
      [
        "workflow",
        "--workspace",
        workspaceRoot,
        "--data-root",
        dataRoot,
        "--manifest",
        "workflow.json",
        "--thread",
        sourceWorkflow.threadId,
        "--plan",
        sourceWorkflow.planId,
        "--from-node",
        "answer",
        "--jsonl",
      ],
      {
        cwd: root,
        env: { DEEPSEEK_API_KEY: apiKey },
        stdout: experimentStdout,
        stderr: experimentStderr,
      },
    );
    expect(experimentCode).toBe(0);
    expect(experimentStderr.text()).toBe("");
    const experimentFrames = experimentStdout
      .text()
      .split("\n")
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as
            | StreamFrame
            | ExecutionPlanWorkflowExperimentResultFrame,
      );
    const liveExperiment = validateExecutionPlanWorkflowExperimentResultFrame(
      experimentFrames.at(-1),
    ).experiment;
    expect(liveExperiment.result.output).toBe("NAPIER_WORKFLOW_LIVE_OK");
    expect(liveExperiment.comparison).toEqual(
      expect.objectContaining({
        inputChange: "unchanged",
        outputChange: "unchanged",
      }),
    );
    expect(stdout.text()).not.toContain(apiKey);
    expect(experimentStdout.text()).not.toContain(apiKey);
  }, 90_000);
});

function liveWorkflowInputSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      request: { type: "string", minLength: 1, maxLength: 200 },
    },
    required: ["request"],
    additionalProperties: false,
  };
}

function terminalEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
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
}
