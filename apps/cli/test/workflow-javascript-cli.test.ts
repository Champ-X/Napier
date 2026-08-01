import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import type { StreamFrame, WorkflowObjectSchema } from "@napier/contracts";
import {
  createExecutionPlanBlueprint,
  createLocalAgentRuntime,
  defineExecutionPlanWorkflow,
  validateExecutionPlanWorkflowResultFrame,
  type OsSandboxAdapter,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier CLI JavaScript Workflow", () => {
  it("executes stateful cells through ordered JSONL", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();
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
        '{"values":[3,4,5]}',
        "--jsonl",
      ],
      {
        cwd: fixture.root,
        env: {},
        stdout,
        stderr,
      },
      {
        createRuntime: (options) =>
          createLocalAgentRuntime({
            ...options,
            sandbox: directSandbox(),
          }),
      },
    );
    expect(code).toBe(0);
    expect(stderr.text()).toBe("");
    const frames = stdout
      .text()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as StreamFrame);
    const terminal = validateExecutionPlanWorkflowResultFrame(frames.at(-1));
    expect(terminal).toEqual(
      expect.objectContaining({
        status: "completed",
        result: expect.objectContaining({
          output: { sum: 12, count: 3 },
          nodeResults: [
            expect.objectContaining({
              nodeId: "calculate",
              status: "completed",
            }),
          ],
        }),
      }),
    );
    const events = frames.flatMap((frame) =>
      frame.type === "event" ? [frame.event] : [],
    );
    expect(
      events.find((event) => event.type === "workflow.javascript.completed")
        ?.payload,
    ).toEqual(
      expect.objectContaining({
        cellCount: 2,
        outputBytes: 20,
      }),
    );
    expect(events.map((event) => event.seq)).toEqual(
      events.map((_, index) => index + 1),
    );
    expect(JSON.stringify(events)).not.toContain("PRIVATE_CLI_CELL");
  }, 20_000);
});

interface Fixture {
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-cli-workflow-javascript-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    sandbox: directSandbox(),
  });
  try {
    const thread = services.store.listThreads()[0]!;
    await services.store.updateAgent(thread.agentId, {
      toolPolicy: "workspace",
      enabledTools: ["javascript_kernel"],
    });
    const plan = await services.store.createPlan(thread.id, {
      objective: "Execute JavaScript cells through CLI JSONL.",
      steps: [
        {
          id: "calculate",
          title: "Calculate",
          description: "Calculate a typed sum and count.",
          verification: "Return the expected JSON value.",
        },
      ],
    });
    const blueprint = await createExecutionPlanBlueprint(
      services.store,
      thread.id,
      plan.id,
    );
    const manifest = defineExecutionPlanWorkflow({
      name: "CLI JavaScript calculation",
      version: 1,
      description: "Exercise a stateful JavaScript Workflow node.",
      blueprint,
      inputSchema: valuesSchema(),
      outputSchema: summarySchema(),
      outputNodeId: "calculate",
      nodes: [
        {
          id: "calculate",
          type: "javascript",
          inputBindings: {
            workflow: { source: "workflow" },
          },
          inputSchema: {
            type: "object",
            properties: { workflow: valuesSchema() },
            required: ["workflow"],
            additionalProperties: false,
          },
          outputSchema: summarySchema(),
          cells: [
            "const PRIVATE_CLI_CELL = input.workflow.values.slice(); PRIVATE_CLI_CELL.length",
            "({ sum: PRIVATE_CLI_CELL.reduce((total, value) => total + value, 0), count: PRIVATE_CLI_CELL.length })",
          ],
          evaluationTimeoutMs: 1_000,
          timeoutMs: 10_000,
          maxAttempts: 1,
        },
      ],
    });
    await writeFile(
      path.join(workspaceRoot, "workflow.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  } finally {
    await services.shutdown();
  }
  return { root, workspaceRoot, dataRoot };
}

function valuesSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      values: {
        type: "array",
        items: { type: "integer", minimum: 0, maximum: 100 },
        minItems: 1,
        maxItems: 8,
      },
    },
    required: ["values"],
    additionalProperties: false,
  };
}

function summarySchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      sum: { type: "integer", minimum: 0, maximum: 800 },
      count: { type: "integer", minimum: 1, maximum: 8 },
    },
    required: ["sum", "count"],
    additionalProperties: false,
  };
}

class CaptureWritable extends Writable {
  private value = "";

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.value += chunk.toString();
    callback();
  }

  text(): string {
    return this.value;
  }
}

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-cli-workflow-javascript-test",
    async launch(request) {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: { ...request.env },
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exit,
        async terminate() {
          if (child.exitCode === null && child.signalCode === null) {
            if (child.pid !== undefined) {
              try {
                process.kill(-child.pid, "SIGTERM");
              } catch {
                child.kill("SIGTERM");
              }
            }
          }
          await exit;
        },
      };
    },
  };
}
