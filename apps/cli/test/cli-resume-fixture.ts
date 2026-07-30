import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { fauxProvider } from "@earendil-works/pi-ai";
import type { StreamFrame } from "@napier/contracts";
import {
  createLocalAgentRuntime,
  UnsupportedSandboxAdapter,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";

import type {
  CliIo,
  RunCliDependencies,
} from "../src/cli.js";

export interface ResumeFixture {
  root: string;
  workspaceRoot: string;
  dataRoot: string;
  threadId: string;
  runId: string;
}

export async function createInterruptedFixture(
  temporaryRoots: string[],
): Promise<ResumeFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-cli-resume-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "state");
  await mkdir(workspaceRoot);
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    env: {},
    sandbox: new UnsupportedSandboxAdapter("cli-resume-setup"),
  });
  const agent = services.store.listAgents()[0]!;
  const thread = await services.store.createThread({
    title: "CLI resume fixture",
    agentId: agent.id,
  });
  const run = await services.store.createRun({
    threadId: thread.id,
    agentId: agent.id,
    model: { provider: "faux-prior-resume", id: "faux-1" },
  });
  await services.store.appendEvent({
    threadId: thread.id,
    runId: run.id,
    type: "message.user",
    category: "message",
    visibility: "user",
    payload: { role: "user", text: "Resume the interrupted task." },
  });
  await services.store.appendEvent({
    threadId: thread.id,
    runId: run.id,
    type: "tool.started",
    category: "tool",
    visibility: "user",
    payload: {
      callId: "unknown-write",
      toolName: "apply_patch",
      status: "started",
      inputSha256:
        "34b291c6783a769251d4bd073f563a7b85b3c63e8753f30432b2f5cb84f6af50",
      inputRedacted: true,
    },
  });
  await services.shutdown();
  return {
    root,
    workspaceRoot,
    dataRoot,
    threadId: thread.id,
    runId: run.id,
  };
}

export function providerDependencies(
  provider: ReturnType<typeof fauxProvider>,
): RunCliDependencies {
  return {
    async createRuntime(options: LocalAgentRuntimeOptions) {
      const services = await createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("cli-resume-test"),
      });
      services.models.registerProvider(provider.provider);
      return services;
    },
  };
}

export function cliIo(
  fixture: ResumeFixture,
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

export function parseFrames(output: string): StreamFrame[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StreamFrame);
}

export function collect(stream: NodeJS.ReadableStream): Promise<string> {
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

export function deferred<T>(): {
  promise: Promise<T>;
  resolve(value?: T): void;
} {
  let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value as T);
    },
  };
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
