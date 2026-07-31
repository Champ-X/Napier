import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type {
  ExecutionPlanWorkflowResultFrame,
  StreamFrame,
} from "@napier/contracts";
import {
  createExecutionPlanBlueprint,
  createLocalAgentRuntime,
  defineExecutionPlanWorkflow,
  UnsupportedSandboxAdapter,
  validateExecutionPlanWorkflowResultFrame,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { runCli, type CliIo, type RunCliDependencies } from "../src/cli.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Workflow Loop CLI", () => {
  it("streams sequential Loop iterations through ordered JSONL", async () => {
    const fixture = await createFixture();
    const provider = fauxProvider({ provider: "faux-workflow-loop-cli" });
    provider.setResponses([
      fauxAssistantMessage(
        JSON.stringify({ done: false, iteration: 1, note: "draft" }),
      ),
      fauxAssistantMessage(
        JSON.stringify({ done: true, iteration: 2, note: "verified" }),
      ),
    ]);
    const stdout = new CaptureWritable();

    const code = await runCli(
      [
        "workflow",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--manifest",
        "workflow.json",
        "--input-json",
        '{"goal":"Produce a verified CLI result."}',
        "--jsonl",
      ],
      cliIo(fixture.root, stdout),
      providerDependencies(provider),
    );

    expect(code).toBe(0);
    const frames = parseFrames(stdout.text());
    const result = validateExecutionPlanWorkflowResultFrame(frames.at(-1));
    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        result: expect.objectContaining({
          output: { done: true, iteration: 2, note: "verified" },
        }),
      }),
    );
    const events = frames
      .filter(
        (frame): frame is Extract<StreamFrame, { type: "event" }> =>
          frame.type === "event",
      )
      .map((frame) => frame.event);
    expect(
      events.filter(
        (event) => event.type === "workflow.loop.iteration.completed",
      ),
    ).toHaveLength(2);
    expect(
      events.filter((event) => event.type === "workflow.loop.completed"),
    ).toHaveLength(1);
    expect(events.map((event) => event.seq)).toEqual(
      events.map((_, index) => index + 1),
    );
  });
});

async function createFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-loop-cli-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    sandbox: new UnsupportedSandboxAdapter("workflow-loop-cli-setup"),
  });
  const sourceThread = services.store.listThreads()[0]!;
  const sourcePlan = await services.store.createPlan(sourceThread.id, {
    objective: "Refine one CLI result.",
    steps: [
      {
        id: "refine",
        title: "Refine",
        description: "Advance the previous result by one typed iteration.",
        verification: "Stop only when done is true.",
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    services.store,
    sourceThread.id,
    sourcePlan.id,
  );
  const manifest = defineExecutionPlanWorkflow({
    name: "CLI bounded Loop",
    version: 1,
    description: "Run sequential read-only Agent iterations through JSONL.",
    blueprint,
    inputSchema: inputSchema(),
    outputSchema: outputSchema(),
    outputNodeId: "refine",
    nodes: [
      {
        id: "refine",
        type: "loop",
        inputBindings: {
          goal: { source: "workflow", path: ["goal"] },
        },
        inputSchema: inputSchema(),
        outputSchema: outputSchema(),
        until: { path: ["done"], equals: true },
        model: { provider: "faux-workflow-loop-cli", id: "faux-1" },
        maxIterations: 3,
        iterationTimeoutMs: 5_000,
        timeoutMs: 15_000,
        maxAttempts: 2,
      },
    ],
  });
  await writeFile(
    path.join(workspaceRoot, "workflow.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await services.shutdown();
  return { root, workspaceRoot, dataRoot };
}

function providerDependencies(
  provider: ReturnType<typeof fauxProvider>,
): RunCliDependencies {
  return {
    async createRuntime(options: LocalAgentRuntimeOptions) {
      const services = await createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("workflow-loop-cli-test"),
      });
      services.models.registerProvider(provider.provider);
      return services;
    },
  };
}

function inputSchema() {
  return {
    type: "object" as const,
    properties: {
      goal: { type: "string" as const, minLength: 1, maxLength: 200 },
    },
    required: ["goal"],
    additionalProperties: false as const,
  };
}

function outputSchema() {
  return {
    type: "object" as const,
    properties: {
      done: { type: "boolean" as const },
      iteration: { type: "integer" as const, minimum: 1, maximum: 8 },
      note: { type: "string" as const, minLength: 1, maxLength: 100 },
    },
    required: ["done", "iteration", "note"],
    additionalProperties: false as const,
  };
}

function parseFrames(
  text: string,
): Array<StreamFrame | ExecutionPlanWorkflowResultFrame> {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as StreamFrame | ExecutionPlanWorkflowResultFrame,
    );
}

function cliIo(root: string, stdout: Writable): CliIo {
  return {
    cwd: root,
    env: {},
    stdout,
    stderr: new CaptureWritable(),
  };
}

class CaptureWritable extends Writable {
  private readonly chunks: Buffer[] = [];

  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}
