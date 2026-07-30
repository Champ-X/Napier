import { spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import type { StreamFrame } from "@napier/contracts";
import {
  createLocalAgentRuntime,
  UnsupportedSandboxAdapter,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";

import type { CliIo, RunCliDependencies } from "../src/cli.js";

export interface BranchFixture {
  root: string;
  workspaceRoot: string;
  dataRoot: string;
  threadId: string;
  firstRunId: string;
  initialThreadCount: number;
}

export async function createBranchFixture(
  temporaryRoots: string[],
): Promise<BranchFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-cli-branch-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "state");
  await mkdir(workspaceRoot);
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    env: {},
    sandbox: new UnsupportedSandboxAdapter("cli-branch-setup"),
  });
  const agent = services.store.listAgents()[0]!;
  const thread = await services.store.createThread({
    title: "CLI branch source",
    agentId: agent.id,
  });
  const firstRun = await services.store.createRun({
    threadId: thread.id,
    agentId: agent.id,
  });
  await appendMessage(
    services,
    thread.id,
    firstRun.id,
    "message.user",
    "First request",
  );
  await appendMessage(
    services,
    thread.id,
    firstRun.id,
    "message.assistant",
    "First answer",
  );
  await services.store.finishRun(firstRun.id, "completed");
  const secondRun = await services.store.createRun({
    threadId: thread.id,
    agentId: agent.id,
  });
  await appendMessage(
    services,
    thread.id,
    secondRun.id,
    "message.user",
    "Second request",
  );
  await appendMessage(
    services,
    thread.id,
    secondRun.id,
    "message.assistant",
    "Second answer",
  );
  await services.store.finishRun(secondRun.id, "completed");
  const initialThreadCount = services.store.listThreads().length;
  await services.shutdown();
  return {
    root,
    workspaceRoot,
    dataRoot,
    threadId: thread.id,
    firstRunId: firstRun.id,
    initialThreadCount,
  };
}

async function appendMessage(
  services: Awaited<ReturnType<typeof createLocalAgentRuntime>>,
  threadId: string,
  runId: string,
  type: "message.user" | "message.assistant",
  text: string,
): Promise<void> {
  await services.store.appendEvent({
    threadId,
    runId,
    type,
    category: "message",
    visibility: "user",
    payload: {
      role: type === "message.user" ? "user" : "assistant",
      text,
    },
  });
}

export function branchDependencies(): RunCliDependencies {
  return {
    createRuntime: (options: LocalAgentRuntimeOptions) =>
      createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("cli-branch-test"),
      }),
  };
}

export async function threadCount(fixture: BranchFixture): Promise<number> {
  const services = await createLocalAgentRuntime({
    workspaceRoot: fixture.workspaceRoot,
    dataRoot: fixture.dataRoot,
    env: {},
    sandbox: new UnsupportedSandboxAdapter("cli-branch-inspect"),
  });
  try {
    return services.store.listThreads().length;
  } finally {
    await services.shutdown();
  }
}

export function cliIo(
  fixture: BranchFixture,
  stdout: Writable,
  stderr: Writable,
): CliIo {
  return {
    cwd: fixture.root,
    env: {},
    stdout,
    stderr,
  };
}

export async function runChild(
  args: string[],
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, args, {
    cwd,
    env: {},
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [code, stdout, stderr] = await Promise.all([
    new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    }),
    collect(child.stdout),
    collect(child.stderr),
  ]);
  return { code, stdout, stderr };
}

export function parseFrames(output: string): StreamFrame[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StreamFrame);
}

function collect(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      output += chunk;
    });
    stream.once("end", () => resolve(output));
    stream.once("error", reject);
  });
}

export class CaptureWritable extends Writable {
  private readonly chunks: Buffer[] = [];

  override _write(
    chunk: Buffer,
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
