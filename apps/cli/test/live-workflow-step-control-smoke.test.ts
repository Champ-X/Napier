import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowExperimentResultFrame,
  ExecutionPlanWorkflowResultFrame,
  JsonValue,
  StreamFrame,
  WorkflowObjectSchema,
} from "@napier/contracts";
import {
  createExecutionPlanBlueprint,
  createLocalAgentRuntime,
  defineExecutionPlanWorkflow,
  exportThreadReplayBundle,
  verifyThreadReplayBundle,
  validateExecutionPlanWorkflowExperimentResultFrame,
  validateExecutionPlanWorkflowResultFrame,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

const describeLive =
  process.env["NAPIER_LIVE_WORKFLOW_STEP_SMOKE"] === "1"
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

describeLive("built CLI Workflow step-control smoke", () => {
  it("releases one parallel rerun node per durable Continue", async () => {
    const fixture = await createFixture();
    const source = validateExecutionPlanWorkflowResultFrame(
      lastRecord(
        await runBuiltCli(fixture, [
          "workflow",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--manifest",
          "workflow.json",
          "--input-json",
          '{"request":"Step through the parallel graph."}',
          "--jsonl",
        ]),
      ),
    );
    expect(source.status).toBe("completed");

    const preview = JSON.parse(
      await runBuiltCli(fixture, [
        "workflow",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--manifest",
        "workflow.json",
        "--thread",
        source.threadId,
        "--plan",
        source.planId,
        "--from-node",
        "prepare",
        "--step-nodes",
        "--preview-experiment",
        "--jsonl",
      ]),
    ) as ExecutionPlanWorkflowExperimentPreview;
    expect(preview).toEqual(
      expect.objectContaining({
        schemaVersion: 5,
        mode: "step_nodes",
        executionNodeIds: ["prepare"],
        stopBeforeNodeIds: ["left", "right", "join"],
      }),
    );

    const forkOutput = await runBuiltCli(fixture, [
      "workflow",
      "--workspace",
      fixture.workspaceRoot,
      "--data-root",
      fixture.dataRoot,
      "--manifest",
      "workflow.json",
      "--thread",
      source.threadId,
      "--plan",
      source.planId,
      "--from-node",
      "prepare",
      "--step-nodes",
      "--expected-preview",
      preview.previewSha256,
      "--jsonl",
    ]);
    const fork = validateExecutionPlanWorkflowExperimentResultFrame(
      lastRecord(forkOutput),
    );
    expect(fork).toEqual(
      expect.objectContaining({
        status: "paused",
        experiment: expect.objectContaining({
          result: expect.objectContaining({
            breakpoint: expect.objectContaining({ nodeId: "left" }),
          }),
        }),
      }),
    );

    const left = await continueStep(fixture, fork, "left", "right");
    const right = await continueStep(fixture, fork, "right", "join");
    expect(completedNodeIds(left)).toContain("left");
    expect(completedNodeIds(left)).not.toContain("right");
    expect(completedNodeIds(right)).toContain("right");
    expect(completedNodeIds(right)).not.toContain("join");

    const completedOutput = await runBuiltCli(fixture, [
      "workflow",
      "--workspace",
      fixture.workspaceRoot,
      "--data-root",
      fixture.dataRoot,
      "--manifest",
      "workflow.json",
      "--thread",
      fork.targetThreadId,
      "--plan",
      fork.targetPlanId,
      "--continue-breakpoint",
      "--jsonl",
    ]);
    const completed = validateExecutionPlanWorkflowResultFrame(
      lastRecord(completedOutput),
    );
    expect(completed).toEqual(
      expect.objectContaining({
        status: "completed",
        result: expect.objectContaining({
          output: { value: "join" },
        }),
      }),
    );

    const runtime = await createLocalAgentRuntime({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      env: {},
    });
    try {
      const events = await runtime.store.listEvents(fork.targetThreadId);
      expect(
        events
          .filter((event) => event.type === "workflow.deterministic.completed")
          .map((event) => record(event.payload)?.["nodeId"]),
      ).toEqual(["prepare", "left", "right", "join"]);
      expect(
        verifyThreadReplayBundle(
          await exportThreadReplayBundle(runtime.store, fork.targetThreadId),
        ).status,
      ).toBe("valid");
    } finally {
      await runtime.shutdown();
    }
  }, 60_000);
});

interface StepFixture {
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}

async function continueStep(
  fixture: StepFixture,
  fork: ExecutionPlanWorkflowExperimentResultFrame,
  releasedNodeId: string,
  nextNodeId: string,
): Promise<string> {
  const output = await runBuiltCli(fixture, [
    "workflow",
    "--workspace",
    fixture.workspaceRoot,
    "--data-root",
    fixture.dataRoot,
    "--manifest",
    "workflow.json",
    "--thread",
    fork.targetThreadId,
    "--plan",
    fork.targetPlanId,
    "--continue-breakpoint",
    "--jsonl",
  ]);
  const result = validateExecutionPlanWorkflowResultFrame(lastRecord(output));
  expect(result).toEqual(
    expect.objectContaining({
      status: "paused",
      result: expect.objectContaining({
        breakpoint: expect.objectContaining({ nodeId: nextNodeId }),
      }),
    }),
  );
  expect(completedNodeIds(output)).toContain(releasedNodeId);
  return output;
}

async function createFixture(): Promise<StepFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-workflow-step-live-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "state");
  await mkdir(workspaceRoot);
  const runtime = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    env: {},
  });
  const sourceThread = runtime.store.listThreads()[0]!;
  const sourcePlan = await runtime.store.createPlan(sourceThread.id, {
    objective: "Exercise durable node-by-node Workflow step control.",
    steps: [
      step("prepare"),
      step("left", ["prepare"]),
      step("right", ["prepare"]),
      step("join", ["left", "right"]),
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    runtime.store,
    sourceThread.id,
    sourcePlan.id,
  );
  const inputSchema = requestSchema();
  const manifest = defineExecutionPlanWorkflow({
    name: "Step control smoke",
    version: 1,
    description: "A four-node parallel deterministic Workflow.",
    blueprint,
    inputSchema,
    outputSchema: valueSchema("join"),
    outputNodeId: "join",
    maxConcurrency: 2,
    nodes: ["prepare", "left", "right", "join"].map((id) => ({
      id,
      type: "deterministic" as const,
      inputBindings: { workflow: { source: "workflow" as const } },
      inputSchema: {
        type: "object" as const,
        properties: { workflow: inputSchema },
        required: ["workflow"],
        additionalProperties: false,
      },
      outputSchema: valueSchema(id),
      template: {
        kind: "object" as const,
        properties: {
          value: { kind: "literal" as const, value: id },
        },
      },
      timeoutMs: 5_000,
      maxAttempts: 1,
    })),
  });
  await writeFile(
    path.join(workspaceRoot, "workflow.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await runtime.shutdown();
  return { root, workspaceRoot, dataRoot };
}

function step(id: string, dependsOn?: string[]) {
  return {
    id,
    title: id,
    description: `Execute ${id}.`,
    verification: `Return the typed ${id} value.`,
    ...(dependsOn ? { dependsOn } : {}),
  };
}

function requestSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      request: { type: "string", minLength: 1, maxLength: 200 },
    },
    required: ["request"],
    additionalProperties: false,
  };
}

function valueSchema(value: string): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      value: { type: "string", enum: [value] },
    },
    required: ["value"],
    additionalProperties: false,
  };
}

async function runBuiltCli(
  fixture: StepFixture,
  args: string[],
): Promise<string> {
  const entrypoint = path.resolve(import.meta.dirname, "../dist/index.js");
  const child = spawn(process.execPath, [entrypoint, ...args], {
    cwd: fixture.root,
    env: {
      PATH: process.env["PATH"],
      HOME: process.env["HOME"],
      TMPDIR: process.env["TMPDIR"],
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = collect(child.stdout);
  const stderr = collect(child.stderr);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  expect(code).toBe(0);
  expect(await stderr).toBe("");
  return stdout;
}

function lastRecord(output: string): unknown {
  return JSON.parse(output.trim().split("\n").at(-1) ?? "null");
}

function completedNodeIds(output: string): string[] {
  return output
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as StreamFrame)
    .filter(
      (frame): frame is Extract<StreamFrame, { type: "event" }> =>
        frame.type === "event" &&
        frame.event.type === "workflow.deterministic.completed",
    )
    .map((frame) => String(record(frame.event.payload)?.["nodeId"] ?? ""));
}

function collect(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      text += chunk;
    });
    stream.once("end", () => resolve(text));
    stream.once("error", reject);
  });
}

function record(value: JsonValue): Record<string, JsonValue> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}
