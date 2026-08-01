import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  createLocalAgentRuntime,
  UnsupportedSandboxAdapter,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseCliArgs,
  runCli,
  type CliIo,
  type RunCliDependencies,
} from "../src/cli.js";
import { createInterruptedFixture } from "./cli-resume-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier full-screen TUI", () => {
  it("parses shared interactive options and rejects non-TTY input before bootstrap", async () => {
    expect(
      parseCliArgs([
        "tui",
        "--workspace",
        ".",
        "--model",
        "napier/demo",
        "--title",
        "Terminal session",
        "--timeout-ms",
        "5000",
      ]),
    ).toEqual({
      kind: "tui",
      options: {
        workspace: ".",
        model: { provider: "napier", id: "demo" },
        title: "Terminal session",
        timeoutMs: 5_000,
        jsonl: false,
      },
    });
    expect(() => parseCliArgs(["tui", "--workspace", ".", "--jsonl"])).toThrow(
      "--jsonl cannot be used with tui",
    );

    const fixture = await createFixture();
    let bootstraps = 0;
    const stderr = new CaptureWritable();
    const code = await runCli(
      ["tui", "--workspace", fixture.workspaceRoot],
      {
        cwd: fixture.root,
        env: {},
        stdin: new PassThrough(),
        stdout: new TtyCapture(),
        stderr,
      },
      {
        async createRuntime() {
          bootstraps += 1;
          throw new Error("must not bootstrap");
        },
      },
    );

    expect(code).toBe(2);
    expect(bootstraps).toBe(0);
    expect(stderr.text()).toContain("requires interactive stdin/stdout TTYs");
  });

  it("runs durable turns, renders body-free tools, switches model and Thread, and shows operator waiting", async () => {
    const fixture = await createFixture();
    await writeFile(
      path.join(fixture.workspaceRoot, "input.txt"),
      "PRIVATE_TOOL_OUTPUT",
    );
    const first = fauxProvider({ provider: "tui-a" });
    first.setResponses([
      fauxAssistantMessage(fauxToolCall("read_file", { path: "input.txt" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("TUI_FIRST_RESULT"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const second = fauxProvider({ provider: "tui-b" });
    second.setResponses([
      fauxAssistantMessage("TUI_SECOND_RESULT"),
      fauxAssistantMessage('{"facts":[]}'),
      fauxAssistantMessage(
        fauxToolCall("request_operator_decision", {
          header: "Scope",
          question: "PRIVATE_OPERATOR_QUESTION",
          options: [
            {
              label: "Runtime",
              description: "PRIVATE_OPERATOR_OPTION",
            },
            { label: "Product", description: "Complete the product path." },
          ],
          multiSelect: false,
        }),
        { stopReason: "toolUse" },
      ),
    ]);
    const input = new RawTtyInput();
    const stdout = new TtyCapture();
    const stderr = new CaptureWritable();
    const running = runCli(
      [
        "tui",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--model",
        "tui-a/faux-1",
        "--title",
        "First TUI thread",
      ],
      tuiIo(fixture.root, input, stdout, stderr),
      providersDependencies([first, second]),
    );

    await ready(stdout);
    input.write("Read the evidence file.\r");
    await waitForFrame(stdout, "TUI_FIRST_RESULT");
    await waitForRunStatus(stdout, "completed");

    input.write("/model tui-b/faux-1\r");
    await waitForFrame(stdout, "Model: tui-b/faux-1");
    input.write("/new Fresh TUI thread\r");
    await waitForFrame(stdout, "Thread: new (Fresh TUI thread)");
    input.write("Continue in the new Thread.\r");
    await waitForFrame(stdout, "TUI_SECOND_RESULT");
    await waitForRunStatus(stdout, "completed");

    input.write("Request a product decision.\r");
    await waitForFrame(stdout, "operator waiting");
    await waitForRunStatus(stdout, "completed");
    expect(stdout.text()).toContain(
      "tool request_operator_decision · completed",
    );
    expect(stdout.text()).not.toContain("PRIVATE_TOOL_OUTPUT");
    expect(stdout.text()).not.toContain("PRIVATE_OPERATOR_QUESTION");
    expect(stdout.text()).not.toContain("PRIVATE_OPERATOR_OPTION");

    input.write("/new Waiting reset\r");
    await vi.waitFor(() => {
      expect(stdout.lastFrame()).toContain("New Thread");
      expect(stdout.lastFrame()).not.toContain("operator waiting");
    });
    input.write("/exit\r");

    expect(await running).toBe(0);
    expect(input.rawModes).toEqual([true, false]);
    expect(stdout.text()).toContain("\u001b[?1049h");
    expect(stdout.text()).toContain("\u001b[?1049l");

    const reopened = await createLocalAgentRuntime({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("tui-inspect"),
    });
    const threads = reopened.store
      .listThreads()
      .filter((thread) => thread.title.includes("TUI thread"));
    expect(threads.map((thread) => thread.title).sort()).toEqual([
      "First TUI thread",
      "Fresh TUI thread",
    ]);
    expect(
      threads
        .flatMap((thread) =>
          reopened.store
            .listRuns(thread.id)
            .flatMap((run) =>
              run.configuration?.model
                ? [run.configuration.model.provider]
                : [],
            ),
        )
        .sort(),
    ).toEqual(["tui-a", "tui-b", "tui-b"]);
    expect(
      threads.find((thread) => thread.title === "Fresh TUI thread")?.status,
    ).toBe("waiting");
    await reopened.shutdown();
  });

  it("isolates a Provider failure and resumes an interrupted Run", async () => {
    const fixture = await createFixture();
    const privateError = "PRIVATE_TUI_PROVIDER_FAILURE";
    const provider = fauxProvider({ provider: "tui-failure" });
    provider.setResponses([
      () => {
        throw new Error(privateError);
      },
      fauxAssistantMessage("TUI_RECOVERED_RESULT"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const input = new RawTtyInput();
    const stdout = new TtyCapture();
    const running = runCli(
      [
        "tui",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--model",
        "tui-failure/faux-1",
        "--title",
        "TUI failure recovery",
      ],
      tuiIo(fixture.root, input, stdout, new CaptureWritable()),
      providersDependencies([provider]),
    );
    await ready(stdout);
    input.write("Fail this turn.\r");
    await waitForRunStatus(stdout, "failed");
    input.write("Recover on the same Thread.\r");
    await waitForFrame(stdout, "TUI_RECOVERED_RESULT");
    await waitForRunStatus(stdout, "completed");
    input.write("/exit\r");
    expect(await running).toBe(0);
    expect(stdout.text()).not.toContain(privateError);

    const reopened = await createLocalAgentRuntime({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("tui-failure-inspect"),
    });
    const thread = reopened.store
      .listThreads()
      .find((candidate) => candidate.title === "TUI failure recovery");
    expect(thread).toBeDefined();
    expect(
      reopened.store
        .listRuns(thread!.id)
        .map((run) => run.status)
        .sort(),
    ).toEqual(["completed", "failed"]);
    await reopened.shutdown();

    const interrupted = await createInterruptedFixture(temporaryRoots);
    const resumeProvider = fauxProvider({ provider: "tui-resume" });
    resumeProvider.setResponses([
      fauxAssistantMessage("TUI_RESUME_RESULT"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const resumeInput = new RawTtyInput();
    const resumeOutput = new TtyCapture();
    const resumeRun = runCli(
      [
        "tui",
        "--workspace",
        interrupted.workspaceRoot,
        "--data-root",
        interrupted.dataRoot,
        "--thread",
        interrupted.threadId,
        "--model",
        "tui-resume/faux-1",
      ],
      tuiIo(interrupted.root, resumeInput, resumeOutput, new CaptureWritable()),
      providersDependencies([resumeProvider]),
    );
    await ready(resumeOutput);
    resumeInput.write(`/resume ${interrupted.runId}\r`);
    await waitForFrame(resumeOutput, "TUI_RESUME_RESULT");
    await waitForRunStatus(resumeOutput, "completed");
    resumeInput.write("/exit\r");
    expect(await resumeRun).toBe(0);
    expect(resumeInput.rawModes).toEqual([true, false]);
  });

  it("cancels an active Run and times out another without leaving raw mode", async () => {
    const cancelledFixture = await createFixture();
    const cancelProvider = fauxProvider({ provider: "tui-cancel" });
    const cancelEntered = deferred<void>();
    const cancelRelease = deferred<void>();
    cancelProvider.setResponses([
      async () => {
        cancelEntered.resolve();
        await cancelRelease.promise;
        return fauxAssistantMessage("CANCELLED_TEXT_MUST_NOT_COMPLETE");
      },
    ]);
    const cancelInput = new RawTtyInput();
    const cancelOutput = new TtyCapture();
    const cancelRun = runCli(
      [
        "tui",
        "--workspace",
        cancelledFixture.workspaceRoot,
        "--data-root",
        cancelledFixture.dataRoot,
        "--model",
        "tui-cancel/faux-1",
      ],
      tuiIo(
        cancelledFixture.root,
        cancelInput,
        cancelOutput,
        new CaptureWritable(),
      ),
      providersDependencies([cancelProvider]),
    );
    await ready(cancelOutput);
    cancelInput.write("Start cancellable work.\r");
    await cancelEntered.promise;
    cancelInput.write("A concurrent prompt must not queue.\r");
    await waitForFrame(
      cancelOutput,
      "A Run is already active; Ctrl-C cancels it",
    );
    cancelInput.write("\u0003");
    cancelRelease.resolve();
    await waitForRunStatus(cancelOutput, "cancelled");
    cancelInput.write("/exit\r");
    expect(await cancelRun).toBe(0);
    expect(cancelOutput.text()).not.toContain(
      "CANCELLED_TEXT_MUST_NOT_COMPLETE",
    );
    expect(cancelInput.rawModes).toEqual([true, false]);
    const cancelledReopened = await createLocalAgentRuntime({
      workspaceRoot: cancelledFixture.workspaceRoot,
      dataRoot: cancelledFixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("tui-cancel-inspect"),
    });
    const cancelledThreads = cancelledReopened.store.listThreads();
    expect(
      cancelledThreads
        .flatMap((thread) => cancelledReopened.store.listRuns(thread.id))
        .filter((run) => run.source === "user"),
    ).toHaveLength(1);
    const cancelledEvents = (
      await Promise.all(
        cancelledThreads.map((thread) =>
          cancelledReopened.store.listEvents(thread.id),
        ),
      )
    ).flat();
    expect(JSON.stringify(cancelledEvents)).not.toContain(
      "A concurrent prompt must not queue.",
    );
    await cancelledReopened.shutdown();

    const timeoutFixture = await createFixture();
    const timeoutProvider = fauxProvider({ provider: "tui-timeout" });
    const timeoutEntered = deferred<void>();
    const timeoutRelease = deferred<void>();
    timeoutProvider.setResponses([
      async () => {
        timeoutEntered.resolve();
        await timeoutRelease.promise;
        return fauxAssistantMessage("TIMED_OUT_TEXT_MUST_NOT_COMPLETE");
      },
    ]);
    const timeoutInput = new RawTtyInput();
    const timeoutOutput = new TtyCapture();
    const timeoutRun = runCli(
      [
        "tui",
        "--workspace",
        timeoutFixture.workspaceRoot,
        "--data-root",
        timeoutFixture.dataRoot,
        "--model",
        "tui-timeout/faux-1",
        "--timeout-ms",
        "1000",
      ],
      tuiIo(
        timeoutFixture.root,
        timeoutInput,
        timeoutOutput,
        new CaptureWritable(),
      ),
      providersDependencies([timeoutProvider]),
    );
    await ready(timeoutOutput);
    timeoutInput.write("Start timed work.\r");
    await timeoutEntered.promise;
    await waitForFrame(timeoutOutput, "timed out after 1000 ms", 5_000);
    timeoutRelease.resolve();
    await waitForFrame(
      timeoutOutput,
      "Turn timed out after 1000 ms; Run cancelled",
    );
    timeoutInput.write("/exit\r");
    expect(await timeoutRun).toBe(0);
    expect(timeoutOutput.text()).not.toContain(
      "TIMED_OUT_TEXT_MUST_NOT_COMPLETE",
    );
    expect(timeoutInput.rawModes).toEqual([true, false]);
  });

  it("restores terminal state on idle Ctrl-C, Ctrl-D, and EOF", async () => {
    let shutdowns = 0;
    const cases = [
      { trigger: (input: RawTtyInput) => input.write("\u0003"), code: 130 },
      { trigger: (input: RawTtyInput) => input.write("\u0004"), code: 0 },
      { trigger: (input: RawTtyInput) => input.end(), code: 0 },
    ];
    for (const current of cases) {
      const fixture = await createFixture();
      const input = new RawTtyInput();
      const output = new TtyCapture();
      const running = runCli(
        [
          "tui",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
        ],
        tuiIo(fixture.root, input, output, new CaptureWritable()),
        providersDependencies([], undefined, () => {
          shutdowns += 1;
        }),
      );
      await ready(output);
      current.trigger(input);
      expect(await running).toBe(current.code);
      expect(input.rawModes).toEqual([true, false]);
      expect(output.text()).toContain("\u001b[?1049l");
    }
    expect(shutdowns).toBe(3);
  });

  it("restores a partially changed raw mode before Runtime bootstrap", async () => {
    const fixture = await createFixture();
    const input = new PartialRawFailureInput();
    const output = new TtyCapture();
    const stderr = new CaptureWritable();
    let bootstraps = 0;
    const code = await runCli(
      ["tui", "--workspace", fixture.workspaceRoot],
      tuiIo(fixture.root, input, output, stderr),
      {
        async createRuntime() {
          bootstraps += 1;
          throw new Error("must not bootstrap");
        },
      },
    );

    expect(code).toBe(1);
    expect(bootstraps).toBe(0);
    expect(input.rawModes).toEqual([true, false]);
    expect(input.isRaw).toBe(false);
    expect(output.text()).not.toContain("\u001b[?1049h");
    expect(stderr.text()).not.toContain("PRIVATE_PARTIAL_RAW_FAILURE");
  });

  it("restores terminal state after a bootstrap failure", async () => {
    const fixture = await createFixture();
    const bootstrapInput = new RawTtyInput();
    const bootstrapOutput = new TtyCapture();
    const privateBootstrap = "PRIVATE_TUI_BOOTSTRAP";
    const bootstrapError = await runCli(
      ["tui", "--workspace", fixture.workspaceRoot],
      tuiIo(
        fixture.root,
        bootstrapInput,
        bootstrapOutput,
        new CaptureWritable(),
      ),
      {
        async createRuntime() {
          throw new Error(privateBootstrap);
        },
      },
    );
    expect(bootstrapError).toBe(1);
    expect(bootstrapInput.rawModes).toEqual([true, false]);
    expect(bootstrapOutput.text()).toContain("\u001b[?1049l");
    expect(bootstrapOutput.text()).not.toContain(privateBootstrap);
  });

  it("restores terminal state after an output failure", async () => {
    const fixture = await createFixture();
    let shutdowns = 0;
    const outputInput = new RawTtyInput();
    const brokenOutput = new TtyCapture("Ready; type a prompt");
    const privateOutput = "PRIVATE_TUI_OUTPUT";
    brokenOutput.failure = new Error(privateOutput);
    const outputStderr = new CaptureWritable();
    const outputError = await runCli(
      [
        "tui",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        path.join(fixture.root, "output-state"),
      ],
      tuiIo(fixture.root, outputInput, brokenOutput, outputStderr),
      providersDependencies([], undefined, () => {
        shutdowns += 1;
      }),
    );
    expect(outputError).toBe(1);
    expect(shutdowns).toBe(1);
    expect(outputInput.rawModes).toEqual([true, false]);
    expect(brokenOutput.text()).not.toContain("\u001b[?1049l");
    expect(outputStderr.text()).not.toContain(privateOutput);
  });

  it("restores terminal state after parent termination", async () => {
    const fixture = await createFixture();
    let shutdowns = 0;
    const parentInput = new RawTtyInput();
    const parentOutput = new TtyCapture();
    const parent = new AbortController();
    const parentRun = runCli(
      [
        "tui",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        path.join(fixture.root, "parent-state"),
      ],
      tuiIo(fixture.root, parentInput, parentOutput, new CaptureWritable()),
      providersDependencies([], undefined, () => {
        shutdowns += 1;
      }),
      parent.signal,
    );
    await ready(parentOutput);
    parent.abort(new Error("PRIVATE_PARENT_REASON"));
    expect(await parentRun).toBe(1);
    expect(shutdowns).toBe(1);
    expect(parentInput.rawModes).toEqual([true, false]);
    expect(parentOutput.text()).toContain("\u001b[?1049l");
    expect(parentOutput.text()).not.toContain("PRIVATE_PARENT_REASON");
  });
});

async function createFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-tui-test-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "state");
  await mkdir(workspaceRoot);
  return { root, workspaceRoot, dataRoot };
}

function providersDependencies(
  providers: Array<ReturnType<typeof fauxProvider>>,
  onBootstrap?: () => void,
  onShutdown?: () => void,
): RunCliDependencies {
  return {
    async createRuntime(options: LocalAgentRuntimeOptions) {
      onBootstrap?.();
      const services = await createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("tui-test"),
      });
      for (const provider of providers) {
        services.models.registerProvider(provider.provider);
      }
      if (onShutdown) {
        const shutdown = services.shutdown.bind(services);
        services.shutdown = async () => {
          onShutdown();
          await shutdown();
        };
      }
      return services;
    },
  };
}

function tuiIo(
  cwd: string,
  stdin: RawTtyInput,
  stdout: TtyCapture,
  stderr: Writable,
): CliIo {
  return { cwd, env: {}, stdin, stdout, stderr };
}

async function ready(output: TtyCapture): Promise<void> {
  await waitForFrame(output, "Ready; type a prompt", 5_000);
}

async function waitForFrame(
  output: TtyCapture,
  value: string,
  timeout = 10_000,
): Promise<void> {
  await vi.waitFor(() => expect(output.lastFrame()).toContain(value), {
    timeout,
  });
}

async function waitForRunStatus(
  output: TtyCapture,
  status: "completed" | "failed" | "cancelled",
  timeout = 10_000,
): Promise<void> {
  await vi.waitFor(
    () => {
      expect(output.lastFrame()).toMatch(
        new RegExp(`Run run_[a-z0-9_-]+ ${status}`, "u"),
      );
    },
    { timeout },
  );
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

class RawTtyInput extends PassThrough {
  readonly isTTY = true;
  isRaw = false;
  readonly rawModes: boolean[] = [];

  setRawMode(enabled: boolean): void {
    this.isRaw = enabled;
    this.rawModes.push(enabled);
  }
}

class PartialRawFailureInput extends RawTtyInput {
  private failed = false;

  override setRawMode(enabled: boolean): void {
    super.setRawMode(enabled);
    if (enabled && !this.failed) {
      this.failed = true;
      throw new Error("PRIVATE_PARTIAL_RAW_FAILURE");
    }
  }
}

class TtyCapture extends Writable {
  readonly isTTY = true;
  readonly columns = 100;
  readonly rows = 30;
  failure?: Error;
  private readonly chunks: string[] = [];
  private failed = false;

  constructor(private readonly failOnceOn?: string) {
    super({ highWaterMark: 1 });
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const text = chunk.toString("utf8");
    if (
      !this.failed &&
      this.failOnceOn !== undefined &&
      text.includes(this.failOnceOn)
    ) {
      this.failed = true;
      callback(this.failure ?? new Error("TUI test output failure"));
      return;
    }
    this.chunks.push(text);
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }

  lastFrame(): string {
    return this.text().split("\u001b[H\u001b[2J").at(-1) ?? "";
  }
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
