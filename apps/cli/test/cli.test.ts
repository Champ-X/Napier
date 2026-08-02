import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { StreamFrame } from "@napier/contracts";
import {
  createLocalAgentRuntime,
  hashEventStream,
  sha256,
  UnsupportedSandboxAdapter,
  type LocalAgentRuntimeOptions,
  type LocalAgentRuntimeServices,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  CLI_HELP,
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

describe("Napier one-shot CLI", () => {
  it("parses explicit run options and rejects malformed input", () => {
    expect(
      parseCliArgs([
        "run",
        "--workspace",
        ".",
        "--prompt",
        "Inspect the workspace.",
        "--model",
        "deepseek/deepseek-v4-flash",
        "--credential-env",
        "DEEPSEEK_API_KEY",
        "--timeout-ms",
        "5000",
        "--jsonl",
      ]),
    ).toEqual({
      kind: "run",
      options: {
        workspace: ".",
        prompt: "Inspect the workspace.",
        model: { provider: "deepseek", id: "deepseek-v4-flash" },
        credentialEnv: "DEEPSEEK_API_KEY",
        timeoutMs: 5_000,
        jsonl: true,
      },
    });
    expect(parseCliArgs(["run", "--help"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["--version"])).toEqual({ kind: "version" });
    expect(() =>
      parseCliArgs([
        "run",
        "--workspace",
        ".",
        "--prompt",
        "x",
        "--jsonl",
        "--jsonl",
      ]),
    ).toThrow("Duplicate option");
    expect(() =>
      parseCliArgs([
        "run",
        "--workspace",
        ".",
        "--prompt",
        "x",
        "--thread",
        "thread_abcdefghijklmnopqrst",
        "--title",
        "conflict",
      ]),
    ).toThrow("--title cannot be used");
    expect(() =>
      parseCliArgs([
        "run",
        "--workspace",
        ".",
        "--prompt",
        "x",
        "--timeout-ms",
        "999",
      ]),
    ).toThrow("--timeout-ms must be");
    expect(() =>
      parseCliArgs([
        "run",
        "--workspace",
        ".",
        "--prompt",
        "x",
        "--credential-env",
        "DEEPSEEK_API_KEY",
      ]),
    ).toThrow("--credential-env requires a live --model");
    expect(() =>
      parseCliArgs([
        "run",
        "--workspace",
        ".",
        "--prompt",
        "x",
        "--model",
        "deepseek/deepseek-v4-flash",
        "--credential-env",
        "lowercase-key",
      ]),
    ).toThrow("--credential-env is invalid");
  });

  it("streams hash-bound JSONL frames through the real Agent Runtime", async () => {
    const fixture = await createFixture();
    const provider = fauxProvider({ provider: "faux-cli-jsonl" });
    provider.setResponses([
      fauxAssistantMessage("CLI_JSONL_RESULT"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const stdout = new CaptureWritable(2);
    const stderr = new CaptureWritable();
    const firstWriteStartedAt: number[] = [];
    stdout.onWrite = () => firstWriteStartedAt.push(Date.now());
    const startedAt = Date.now();

    const code = await runCli(
      [
        "run",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--prompt",
        "Complete the JSONL one-shot task.",
        "--model",
        "faux-cli-jsonl/faux-1",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, stderr),
      providerDependencies(provider),
    );

    expect(code).toBe(0);
    expect(stderr.text()).toBe("");
    expect(firstWriteStartedAt[0]! - startedAt).toBeLessThan(1_000);
    const frames = parseFrames(stdout.text());
    expect(frames[0]?.type).toBe("event");
    expect(frames.at(-2)?.type).toBe("snapshot");
    expect(frames.at(-1)?.type).toBe("done");
    const eventFrames = frames.filter(
      (frame): frame is Extract<StreamFrame, { type: "event" }> =>
        frame.type === "event",
    );
    expect(eventFrames.length).toBeGreaterThan(4);
    for (const frame of eventFrames) {
      expect(frame.eventSha256).toBe(sha256(JSON.stringify(frame.event)));
    }
    expect(eventFrames.map((frame) => frame.event.seq)).toEqual(
      eventFrames.map((_, index) => index + 1),
    );
    const snapshot = frames.at(-2);
    const done = frames.at(-1);
    expect(snapshot?.type).toBe("snapshot");
    expect(done?.type).toBe("done");
    if (snapshot?.type !== "snapshot" || done?.type !== "done") return;
    expect(done).toEqual(
      expect.objectContaining({
        threadId: snapshot.detail.thread.id,
        status: "completed",
        snapshotSha256: snapshot.detailSha256,
        snapshotBytes: snapshot.detailBytes,
        eventCount: snapshot.detail.thread.eventCount,
        eventBytes: snapshot.eventBytes,
        eventStreamSha256: hashEventStream(snapshot.detail.events),
      }),
    );
    expect(JSON.stringify(snapshot.detail)).toContain("CLI_JSONL_RESULT");
  });

  it("appends to an existing Thread and prints a human result", async () => {
    const fixture = await createFixture();
    const setup = await createLocalAgentRuntime({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("cli-existing-setup"),
    });
    const agent = setup.store.listAgents()[0]!;
    const thread = await setup.store.createThread({
      title: "Existing CLI Thread",
      agentId: agent.id,
    });
    await setup.shutdown();
    const provider = fauxProvider({ provider: "faux-cli-human" });
    provider.setResponses([
      fauxAssistantMessage("CLI_HUMAN_RESULT"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();

    const code = await runCli(
      [
        "run",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--thread",
        thread.id,
        "--prompt",
        "Continue the existing Thread.",
        "--model",
        "faux-cli-human/faux-1",
      ],
      cliIo(fixture.root, stdout, stderr),
      providerDependencies(provider),
    );

    expect(code).toBe(0);
    expect(stdout.text()).toBe("CLI_HUMAN_RESULT\n");
    expect(stderr.text()).toMatch(
      new RegExp(
        `^Napier run run_[a-z0-9]+ completed \\(thread ${thread.id}\\)\\n$`,
        "u",
      ),
    );
  });

  it("allows only one concurrent CLI Run for an existing Thread", async () => {
    const fixture = await createFixture();
    const setup = await createLocalAgentRuntime({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("cli-concurrent-setup"),
    });
    const thread = await setup.store.createThread({
      title: "Concurrent CLI Thread",
      agentId: setup.store.listAgents()[0]!.id,
    });
    await setup.shutdown();
    const entered = deferred<void>();
    const release = deferred<void>();
    const providers: ReturnType<typeof fauxProvider>[] = [];
    let bootstraps = 0;
    const dependencies: RunCliDependencies = {
      async createRuntime(options) {
        const provider = fauxProvider({ provider: "faux-cli-concurrent" });
        providers.push(provider);
        if (bootstraps === 0) {
          provider.setResponses([
            async () => {
              entered.resolve();
              await release.promise;
              return fauxAssistantMessage("FIRST_CLI_RUN");
            },
            fauxAssistantMessage('{"facts":[]}'),
          ]);
        } else {
          provider.setResponses([
            fauxAssistantMessage("SECOND_CLI_RUN_MUST_NOT_EXECUTE"),
            fauxAssistantMessage('{"facts":[]}'),
          ]);
        }
        bootstraps += 1;
        const services = await createLocalAgentRuntime({
          ...options,
          sandbox: new UnsupportedSandboxAdapter("cli-concurrent"),
        });
        services.models.registerProvider(provider.provider);
        return services;
      },
    };
    const args = [
      "run",
      "--workspace",
      fixture.workspaceRoot,
      "--data-root",
      fixture.dataRoot,
      "--thread",
      thread.id,
      "--prompt",
      "Run once.",
      "--model",
      "faux-cli-concurrent/faux-1",
      "--jsonl",
    ];
    const firstStdout = new CaptureWritable();
    const first = runCli(
      args,
      cliIo(fixture.root, firstStdout, new CaptureWritable()),
      dependencies,
    );
    await entered.promise;
    const secondStdout = new CaptureWritable();
    const secondCode = await runCli(
      args,
      cliIo(fixture.root, secondStdout, new CaptureWritable()),
      dependencies,
    );
    release.resolve();
    const firstCode = await first;

    expect(firstCode).toBe(0);
    expect(secondCode).toBe(1);
    expect(parseFrames(firstStdout.text()).at(-1)).toEqual(
      expect.objectContaining({ type: "done", status: "completed" }),
    );
    expect(parseFrames(secondStdout.text())).toEqual([
      expect.objectContaining({
        type: "error",
        threadId: thread.id,
        code: "run_failed",
      }),
    ]);
    expect(providers[1]?.state.callCount).toBe(0);
  });

  it("fails invalid machine input before bootstrap without leaking the input", async () => {
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();
    let bootstraps = 0;
    const secret = "PRIVATE_UNKNOWN_ARGUMENT";
    const code = await runCli(
      ["run", "--jsonl", `--${secret}`],
      cliIo(process.cwd(), stdout, stderr),
      {
        async createRuntime() {
          bootstraps += 1;
          throw new Error("must not bootstrap");
        },
      },
    );

    expect(code).toBe(2);
    expect(bootstraps).toBe(0);
    expect(stderr.text()).toBe("");
    const frames = parseFrames(stdout.text());
    expect(frames).toEqual([
      expect.objectContaining({
        type: "error",
        threadId: "thread_cli_preflight",
        message: "Run failed while streaming.",
        code: "run_failed",
        diagnosticSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
    expect(stdout.text()).not.toContain(secret);
  });

  it("bootstraps and reuses an explicit environment credential locator", async () => {
    const fixture = await createFixture();
    const provider = fauxProvider({ provider: "deepseek" });
    provider.setResponses([
      fauxAssistantMessage("FIRST_TASK_OK"),
      fauxAssistantMessage('{"facts":[]}'),
      fauxAssistantMessage("SECOND_TASK_OK"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const secret = "PRIVATE_EXPLICIT_DEEPSEEK_KEY";
    const dependencies = providerDependencies(provider);
    const runOnce = async (prompt: string): Promise<CaptureWritable> => {
      const stdout = new CaptureWritable();
      const code = await runCli(
        [
          "run",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--prompt",
          prompt,
          "--model",
          "deepseek/faux-1",
          "--credential-env",
          "DEEPSEEK_API_KEY",
          "--jsonl",
        ],
        {
          cwd: fixture.root,
          env: { DEEPSEEK_API_KEY: secret },
          stdout,
          stderr: new CaptureWritable(),
        },
        dependencies,
      );
      expect(code).toBe(0);
      expect(stdout.text()).not.toContain(secret);
      return stdout;
    };

    expect(parseFrames((await runOnce("First task.")).text()).at(-1)).toEqual(
      expect.objectContaining({ type: "done", status: "completed" }),
    );
    expect(parseFrames((await runOnce("Second task.")).text()).at(-1)).toEqual(
      expect.objectContaining({ type: "done", status: "completed" }),
    );

    const providerCalls = provider.state.callCount;
    const conflictStdout = new CaptureWritable();
    const conflictCode = await runCli(
      [
        "run",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--prompt",
        "Conflicting locator.",
        "--model",
        "deepseek/faux-1",
        "--credential-env",
        "OTHER_DEEPSEEK_KEY",
        "--jsonl",
      ],
      {
        cwd: fixture.root,
        env: { OTHER_DEEPSEEK_KEY: "PRIVATE_CONFLICTING_KEY" },
        stdout: conflictStdout,
        stderr: new CaptureWritable(),
      },
      dependencies,
    );
    expect(conflictCode).toBe(1);
    expect(provider.state.callCount).toBe(providerCalls);
    expect(conflictStdout.text()).not.toContain("PRIVATE_CONFLICTING_KEY");

    const inspection = await createLocalAgentRuntime({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      env: { DEEPSEEK_API_KEY: secret },
      sandbox: new UnsupportedSandboxAdapter("cli-credential-inspection"),
    });
    try {
      expect(inspection.store.listCredentialReferences()).toEqual([
        expect.objectContaining({
          providerId: "deepseek",
          source: {
            type: "environment",
            variable: "DEEPSEEK_API_KEY",
          },
          status: "active",
          availability: "available",
        }),
      ]);
      expect(
        JSON.stringify(inspection.store.listCredentialReferences()),
      ).not.toContain(secret);
      expect(inspection.store.listThreads()).toHaveLength(3);
    } finally {
      await inspection.shutdown();
    }
  });

  it("does not use an environment secret without a registered reference", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();
    const secret = "PRIVATE_UNREGISTERED_DEEPSEEK_KEY";
    const code = await runCli(
      [
        "run",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--prompt",
        "This must fail before a live provider call.",
        "--model",
        "deepseek/deepseek-v4-flash",
        "--jsonl",
      ],
      {
        cwd: fixture.root,
        env: { DEEPSEEK_API_KEY: secret },
        stdout,
        stderr: new CaptureWritable(),
      },
      {
        createRuntime(options) {
          return createLocalAgentRuntime({
            ...options,
            sandbox: new UnsupportedSandboxAdapter("cli-unregistered-secret"),
          });
        },
      },
    );

    expect(code).toBe(1);
    expect(parseFrames(stdout.text()).at(-1)).toEqual(
      expect.objectContaining({ type: "done", status: "failed" }),
    );
    expect(stdout.text()).not.toContain(secret);
  });

  it("turns external timeout and cancellation into terminal JSONL evidence", async () => {
    const fixture = await createFixture();
    const timeoutStdout = new CaptureWritable();
    const delayedDependencies: RunCliDependencies = {
      async createRuntime(options) {
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        return createLocalAgentRuntime({
          ...options,
          sandbox: new UnsupportedSandboxAdapter("cli-timeout"),
        });
      },
    };
    const timeoutCode = await runCli(
      [
        "run",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--prompt",
        "Timeout before execution.",
        "--timeout-ms",
        "1000",
        "--jsonl",
      ],
      cliIo(fixture.root, timeoutStdout, new CaptureWritable()),
      delayedDependencies,
    );
    expect(timeoutCode).toBe(1);
    expect(parseFrames(timeoutStdout.text()).at(-1)).toEqual(
      expect.objectContaining({ type: "done", status: "cancelled" }),
    );

    const cancelledFixture = await createFixture();
    const controller = new AbortController();
    controller.abort();
    const cancelledStdout = new CaptureWritable();
    const cancelledCode = await runCli(
      [
        "run",
        "--workspace",
        cancelledFixture.workspaceRoot,
        "--data-root",
        cancelledFixture.dataRoot,
        "--prompt",
        "Cancelled before execution.",
        "--jsonl",
      ],
      cliIo(cancelledFixture.root, cancelledStdout, new CaptureWritable()),
      {
        createRuntime(options) {
          return createLocalAgentRuntime({
            ...options,
            sandbox: new UnsupportedSandboxAdapter("cli-cancelled"),
          });
        },
      },
      controller.signal,
    );
    expect(cancelledCode).toBe(1);
    expect(parseFrames(cancelledStdout.text()).at(-1)).toEqual(
      expect.objectContaining({ type: "done", status: "cancelled" }),
    );
  }, 10_000);

  it("executes the built CLI as a real Node subprocess", async () => {
    const fixture = await createFixture();
    const entrypoint = path.resolve(import.meta.dirname, "../dist/index.js");
    const child = spawn(
      process.execPath,
      [
        entrypoint,
        "run",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--prompt",
        "Run the built CLI.",
        "--jsonl",
      ],
      {
        cwd: fixture.root,
        env: { ...process.env },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout = collectChild(child.stdout);
    const stderr = collectChild(child.stderr);
    const exit = await new Promise<number | null>((resolve) =>
      child.once("exit", (code) => resolve(code)),
    );

    expect(exit).toBe(0);
    expect(await stderr).toBe("");
    const frames = parseFrames(await stdout);
    expect(frames.at(-1)).toEqual(
      expect.objectContaining({ type: "done", status: "completed" }),
    );
  }, 10_000);

  it("renders deterministic help", async () => {
    const stdout = new CaptureWritable();
    const code = await runCli(
      ["run", "--help"],
      cliIo(process.cwd(), stdout, new CaptureWritable()),
    );
    expect(code).toBe(0);
    expect(stdout.text()).toBe(`${CLI_HELP}\n`);
  });
});

function providerDependencies(
  provider: ReturnType<typeof fauxProvider>,
): RunCliDependencies {
  return {
    async createRuntime(options: LocalAgentRuntimeOptions) {
      const services = await createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("cli-faux"),
      });
      services.models.registerProvider(provider.provider);
      return services;
    },
  };
}

async function createFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-cli-test-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "state");
  await mkdir(workspaceRoot);
  return { root, workspaceRoot, dataRoot };
}

function cliIo(cwd: string, stdout: Writable, stderr: Writable): CliIo {
  return { cwd, env: {}, stdout, stderr };
}

function parseFrames(output: string): StreamFrame[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StreamFrame);
}

function collectChild(stream: NodeJS.ReadableStream): Promise<string> {
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

function deferred<T>(): {
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

class CaptureWritable extends Writable {
  private readonly chunks: string[] = [];
  onWrite?: () => void;

  constructor(private readonly delayMs = 0) {
    super({ highWaterMark: 1 });
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.onWrite?.();
    this.chunks.push(chunk.toString("utf8"));
    if (this.delayMs > 0) {
      setTimeout(callback, this.delayMs);
    } else {
      callback();
    }
  }

  text(): string {
    return this.chunks.join("");
  }
}
