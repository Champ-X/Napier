import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";

import type {
  ExecutionPlanWorkflowManifest,
  StreamFrame,
  WorkflowObjectSchema,
} from "@napier/contracts";
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

describe("Napier CLI Python Workflow", () => {
  it("executes exact stateful cells through ordered JSONL", async () => {
    const fixture = await createFixture("jsonl");
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
        }),
      }),
    );
    const events = frames.flatMap((frame) =>
      frame.type === "event" ? [frame.event] : [],
    );
    const completion = events.find(
      (event) => event.type === "workflow.python.completed",
    );
    expect(completion?.payload).toEqual(
      expect.objectContaining({
        cellCount: 2,
        outputBytes: 20,
        jsonValueSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(completion?.payload).not.toEqual(
      expect.objectContaining({ output: expect.anything() }),
    );
    expect(events.map((event) => event.seq)).toEqual(
      events.map((_, index) => index + 1),
    );
    expect(JSON.stringify(events)).not.toContain("PRIVATE_CLI_PYTHON");
  }, 20_000);

  it("executes the same Manifest through local stdio RPC", async () => {
    const fixture = await createFixture("rpc");
    const stdin = new PassThrough();
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();
    const server = runCli(
      [
        "rpc",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
      ],
      {
        cwd: fixture.root,
        env: {},
        stdin,
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
    sendRpc(stdin, {
      jsonrpc: "2.0",
      id: "initialize",
      method: "initialize",
    });
    await waitForRpc(stdout, (message) => message["id"] === "initialize");
    sendRpc(stdin, {
      jsonrpc: "2.0",
      id: "python-run",
      method: "napier/workflow/run",
      params: {
        manifest: fixture.manifest,
        input: { values: [6, 7] },
        title: "RPC Python Workflow",
      },
    });
    const response = await waitForRpc(
      stdout,
      (message) => message["id"] === "python-run",
    );
    expect(response["result"]).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { sum: 13, count: 2 },
      }),
    );
    const notifications = stdout
      .messages()
      .filter(
        (message) =>
          message["method"] === "napier/event" &&
          record(message["params"])?.["requestId"] === "python-run",
      );
    const completion = notifications
      .map((message) => record(record(message["params"])?.["event"]))
      .find((event) => event?.["type"] === "workflow.python.completed");
    expect(record(completion?.["payload"])).toEqual(
      expect.objectContaining({
        cellCount: 2,
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(JSON.stringify(notifications)).not.toContain("PRIVATE_CLI_PYTHON");

    sendRpc(stdin, {
      jsonrpc: "2.0",
      id: "shutdown",
      method: "shutdown",
    });
    await waitForRpc(stdout, (message) => message["id"] === "shutdown");
    sendRpc(stdin, { jsonrpc: "2.0", method: "exit" });
    stdin.end();
    expect(await server).toBe(0);
    expect(stderr.text()).toBe("");
  }, 20_000);
});

interface Fixture {
  root: string;
  workspaceRoot: string;
  dataRoot: string;
  manifest: ExecutionPlanWorkflowManifest;
}

async function createFixture(label: string): Promise<Fixture> {
  const root = await mkdtemp(
    path.join(tmpdir(), `napier-cli-workflow-python-${label}-`),
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
  let manifest: ExecutionPlanWorkflowManifest;
  try {
    const thread = services.store.listThreads()[0]!;
    await services.store.updateAgent(thread.agentId, {
      toolPolicy: "workspace",
      enabledTools: ["python_kernel"],
    });
    const plan = await services.store.createPlan(thread.id, {
      objective: "Execute Python cells through CLI and RPC.",
      steps: [
        {
          id: "calculate",
          title: "Calculate",
          description: "Calculate a typed sum and count.",
          verification: "Return the expected exact JSON value.",
        },
      ],
    });
    const blueprint = await createExecutionPlanBlueprint(
      services.store,
      thread.id,
      plan.id,
    );
    manifest = defineExecutionPlanWorkflow({
      name: "CLI Python calculation",
      version: 1,
      description: "Exercise a stateful Python Workflow node.",
      blueprint,
      inputSchema: valuesSchema(),
      outputSchema: summarySchema(),
      outputNodeId: "calculate",
      nodes: [
        {
          id: "calculate",
          type: "python",
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
            'PRIVATE_CLI_PYTHON = tuple(input["workflow"]["values"])\nlen(PRIVATE_CLI_PYTHON)',
            '{"sum": sum(PRIVATE_CLI_PYTHON), "count": len(PRIVATE_CLI_PYTHON)}',
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
  return { root, workspaceRoot, dataRoot, manifest };
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

function sendRpc(input: PassThrough, message: unknown): void {
  input.write(`${JSON.stringify(message)}\n`);
}

async function waitForRpc(
  output: CaptureWritable,
  predicate: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const match = output.messages().find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for RPC output: ${output.text()}`);
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

  messages(): Array<Record<string, unknown>> {
    return this.text()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-cli-workflow-python-test",
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
