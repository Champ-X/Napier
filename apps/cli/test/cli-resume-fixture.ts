import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { fauxProvider } from "@earendil-works/pi-ai";
import type { StreamFrame } from "@napier/contracts";
import {
  canonicalJson,
  createLocalAgentRuntime,
  ResearchSourceCapsuleStore,
  RunResearchSourceManager,
  sha256,
  UnsupportedSandboxAdapter,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";

import type { CliIo, RunCliDependencies } from "../src/cli.js";

export interface ResumeFixture {
  root: string;
  workspaceRoot: string;
  dataRoot: string;
  threadId: string;
  runId: string;
}

export interface ResearchResumeFixture extends ResumeFixture {
  sourceId: string;
  sourceContentSha256: string;
  citationId: string;
  sourceSecret: string;
}

export async function createInterruptedFixture(
  temporaryRoots: string[],
): Promise<ResumeFixture> {
  return createInterruptedFixtureInternal(temporaryRoots, false);
}

export async function createInterruptedResearchFixture(
  temporaryRoots: string[],
): Promise<ResearchResumeFixture> {
  return createInterruptedFixtureInternal(temporaryRoots, true);
}

async function createInterruptedFixtureInternal(
  temporaryRoots: string[],
  withResearchSource: false,
): Promise<ResumeFixture>;
async function createInterruptedFixtureInternal(
  temporaryRoots: string[],
  withResearchSource: true,
): Promise<ResearchResumeFixture>;
async function createInterruptedFixtureInternal(
  temporaryRoots: string[],
  withResearchSource: boolean,
): Promise<ResumeFixture | ResearchResumeFixture> {
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
  let research:
    | Pick<
        ResearchResumeFixture,
        "sourceId" | "sourceContentSha256" | "citationId" | "sourceSecret"
      >
    | undefined;
  if (withResearchSource) {
    research = await seedResearchSource(services, thread.id, run.id);
  }
  await services.shutdown();
  return {
    root,
    workspaceRoot,
    dataRoot,
    threadId: thread.id,
    runId: run.id,
    ...(research ?? {}),
  };
}

async function seedResearchSource(
  services: Awaited<ReturnType<typeof createLocalAgentRuntime>>,
  threadId: string,
  runId: string,
) {
  const sourceSecret = "CLI_PRIVATE_RESTART_SOURCE";
  const content = {
    url: "https://example.com/cli-restart-source",
    title: "CLI restart Source",
    lines: [sourceSecret],
    truncated: false,
  };
  const manager = new RunResearchSourceManager(
    {
      capturePage: async () => ({
        ...content,
        textChars: sourceSecret.length,
        capturedContentSha256: sha256(canonicalJson(content)),
        sessionOperation: 1,
        sessionIdSha256: "1".repeat(64),
        activeTabId: "tab_1",
        tabCount: 1,
        tabSetSha256: sha256(canonicalJson(["tab_1"])),
        browserExecutableSha256: "2".repeat(64),
        browserVersionSha256: "3".repeat(64),
        limitsSha256: "4".repeat(64),
        network: {
          requestCount: 1,
          connectCount: 1,
          rejectedCount: 0,
          transferredBytes: 128,
          destinationCount: 1,
          destinationsSha256: "5".repeat(64),
        },
      }),
    },
    services.workspaceRoot,
    undefined,
    new ResearchSourceCapsuleStore(services.dataRoot),
    services.store,
  );
  const owner = { threadId, runId };
  const captured = await manager.execute(owner, { action: "capture" });
  const cited = await manager.execute(owner, {
    action: "cite",
    sourceId: captured.details.sourceId!,
    sourceContentSha256: captured.details.sourceContentSha256!,
    startLine: 1,
    endLine: 1,
    claim: "The first process captured private restart evidence.",
  });
  for (const [index, details] of [captured.details, cited.details].entries()) {
    await services.store.appendEvent({
      threadId,
      runId,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      payload: {
        callId: `research-seed-${String(index + 1)}`,
        toolName: "research_source",
        status: "completed",
        details,
      },
    });
  }
  return {
    sourceId: captured.details.sourceId!,
    sourceContentSha256: captured.details.sourceContentSha256!,
    citationId: cited.details.citationId!,
    sourceSecret,
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
