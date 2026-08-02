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
import { spawn as spawnTerminal } from "node-pty";
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

describe("Napier interactive CLI", () => {
  it("parses exact chat options and rejects machine mode", () => {
    expect(
      parseCliArgs([
        "chat",
        "--workspace",
        ".",
        "--model",
        "napier/demo",
        "--agent",
        "agent_napier",
        "--title",
        "Interactive session",
        "--timeout-ms",
        "5000",
      ]),
    ).toEqual({
      kind: "chat",
      options: {
        workspace: ".",
        model: { provider: "napier", id: "demo" },
        agentId: "agent_napier",
        title: "Interactive session",
        timeoutMs: 5_000,
        jsonl: false,
      },
    });
    expect(() => parseCliArgs(["chat", "--workspace", ".", "--jsonl"])).toThrow(
      "--jsonl cannot be used with chat",
    );
    expect(() =>
      parseCliArgs([
        "chat",
        "--workspace",
        ".",
        "--thread",
        "thread_1234567890abcdef1234",
        "--title",
        "conflict",
      ]),
    ).toThrow("--title cannot be used");
    expect(
      parseCliArgs([
        "chat",
        "--workspace",
        ".",
        "--model",
        "deepseek/deepseek-v4-flash",
        "--credential-env",
        "DEEPSEEK_API_KEY",
      ]),
    ).toEqual({
      kind: "chat",
      options: {
        workspace: ".",
        model: { provider: "deepseek", id: "deepseek-v4-flash" },
        credentialEnv: "DEEPSEEK_API_KEY",
        timeoutMs: 600_000,
        jsonl: false,
      },
    });
    expect(() =>
      parseCliArgs([
        "chat",
        "--workspace",
        ".",
        "--credential-env",
        "DEEPSEEK_API_KEY",
      ]),
    ).toThrow("--credential-env requires a live --model");
    expect(() =>
      parseCliArgs([
        "chat",
        "--workspace",
        ".",
        "--model",
        "napier/demo",
        "--credential-env",
        "DEEPSEEK_API_KEY",
      ]),
    ).toThrow("--credential-env requires a live --model");
  });

  it("bootstraps, reuses, and protects an interactive credential locator", async () => {
    const fixture = await createFixture();
    const provider = fauxProvider({ provider: "interactive-bootstrap" });
    provider.setResponses([
      fauxAssistantMessage("CHAT_BOOTSTRAP_FIRST"),
      fauxAssistantMessage('{"facts":[]}'),
      fauxAssistantMessage("CHAT_BOOTSTRAP_SECOND"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const dependencies = providersDependencies([provider]);
    const secret = "PRIVATE_INTERACTIVE_BOOTSTRAP_KEY";
    const runSession = async (prompt: string) => {
      const input = ttyInput("", false);
      const stdout = new CaptureWritable();
      const stderr = new CaptureWritable();
      const running = runCli(
        [
          "chat",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--model",
          "interactive-bootstrap/faux-1",
          "--credential-env",
          "INTERACTIVE_BOOTSTRAP_KEY",
        ],
        {
          ...interactiveIo(fixture.root, input, stdout, stderr),
          env: { INTERACTIVE_BOOTSTRAP_KEY: secret },
        },
        dependencies,
      );
      await vi.waitFor(() => expect(stderr.text()).toContain("chat ready"));
      input.end(`${prompt}\n/exit\n`);
      expect(await running).toBe(0);
      expect(stdout.text()).not.toContain(secret);
      expect(stderr.text()).not.toContain(secret);
      return stdout.text();
    };

    expect(await runSession("First interactive task.")).toContain(
      "CHAT_BOOTSTRAP_FIRST",
    );
    expect(await runSession("Second interactive task.")).toContain(
      "CHAT_BOOTSTRAP_SECOND",
    );
    const providerCalls = provider.state.callCount;
    const conflictSecret = "PRIVATE_INTERACTIVE_CONFLICT_KEY";
    const conflictStderr = new CaptureWritable();
    const conflictCode = await runCli(
      [
        "chat",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--model",
        "interactive-bootstrap/faux-1",
        "--credential-env",
        "OTHER_INTERACTIVE_KEY",
      ],
      {
        ...interactiveIo(
          fixture.root,
          ttyInput("", false),
          new CaptureWritable(),
          conflictStderr,
        ),
        env: { OTHER_INTERACTIVE_KEY: conflictSecret },
      },
      dependencies,
    );
    expect(conflictCode).toBe(1);
    expect(provider.state.callCount).toBe(providerCalls);
    expect(conflictStderr.text()).not.toContain(conflictSecret);

    const reopened = await createLocalAgentRuntime({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      env: { INTERACTIVE_BOOTSTRAP_KEY: secret },
      sandbox: new UnsupportedSandboxAdapter("interactive-bootstrap-inspect"),
    });
    try {
      expect(reopened.store.listCredentialReferences()).toEqual([
        expect.objectContaining({
          providerId: "interactive-bootstrap",
          source: {
            type: "environment",
            variable: "INTERACTIVE_BOOTSTRAP_KEY",
          },
          status: "active",
          availability: "available",
        }),
      ]);
      expect(reopened.store.listThreads()).toHaveLength(3);
      expect(
        JSON.stringify(reopened.store.listCredentialReferences()),
      ).not.toContain(secret);
    } finally {
      await reopened.shutdown();
    }
  });

  it("runs multiple turns, renders tool cards, switches model, and starts a new Thread", async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.workspaceRoot, "input.txt"), "evidence");
    const first = fauxProvider({ provider: "interactive-a" });
    first.setResponses([
      fauxAssistantMessage(fauxToolCall("read_file", { path: "input.txt" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("CHAT_FIRST_RESULT"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const second = fauxProvider({ provider: "interactive-b" });
    second.setResponses([
      fauxAssistantMessage("CHAT_SECOND_RESULT"),
      fauxAssistantMessage('{"facts":[]}'),
      fauxAssistantMessage("CHAT_NEW_THREAD_RESULT"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    let bootstraps = 0;
    const dependencies = providersDependencies([first, second], () => {
      bootstraps += 1;
    });
    const stdout = new CaptureWritable(2);
    const stderr = new CaptureWritable(1);
    const input = ttyInput("", false);
    const running = runCli(
      [
        "chat",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--model",
        "interactive-a/faux-1",
        "--title",
        "First interactive thread",
      ],
      interactiveIo(fixture.root, input, stdout, stderr),
      dependencies,
    );
    await vi.waitFor(() => expect(stderr.text()).toContain("chat ready"));
    input.end(
      [
        "Read the evidence file.",
        "/status",
        "/model interactive-b/faux-1",
        "Continue on the same Thread.",
        "/new Fresh interactive thread",
        "Work on the new Thread.",
        "/exit",
      ].join("\n") + "\n",
    );
    const code = await running;

    expect(code).toBe(0);
    expect(bootstraps).toBe(1);
    expect(count(stdout.text(), "CHAT_FIRST_RESULT")).toBe(1);
    expect(count(stdout.text(), "CHAT_SECOND_RESULT")).toBe(1);
    expect(count(stdout.text(), "CHAT_NEW_THREAD_RESULT")).toBe(1);
    expect(stderr.text()).toContain("[tool] read_file started (read)");
    expect(stderr.text()).toContain("[tool] read_file completed");
    expect(stderr.text()).toContain("Model: interactive-b/faux-1");
    expect(stderr.text()).toContain("Thread: new (Fresh interactive thread)");
    expect(stderr.text()).not.toContain("evidence");

    const reopened = await createLocalAgentRuntime({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("interactive-inspect"),
    });
    const threads = reopened.store.listThreads();
    expect(
      threads
        .map((thread) => thread.title)
        .filter((title) => title.includes("interactive"))
        .sort(),
    ).toEqual(["First interactive thread", "Fresh interactive thread"]);
    const interactiveThreads = threads.filter((thread) =>
      thread.title.includes("interactive"),
    );
    expect(
      interactiveThreads
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
    ).toEqual(["interactive-a", "interactive-b", "interactive-b"]);
    await reopened.shutdown();
  });

  it("switches to an existing Thread and resumes an interrupted Run", async () => {
    const fixture = await createInterruptedFixture(temporaryRoots);
    const provider = fauxProvider({ provider: "interactive-resume" });
    provider.setResponses([
      fauxAssistantMessage("CHAT_RESUME_RESULT"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();
    const input = ttyInput("", false);
    const running = runCli(
      [
        "chat",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--thread",
        fixture.threadId,
        "--model",
        "interactive-resume/faux-1",
      ],
      interactiveIo(fixture.root, input, stdout, stderr),
      providersDependencies([provider]),
    );
    await vi.waitFor(() => expect(stderr.text()).toContain("chat ready"));
    input.end(`/resume ${fixture.runId}\n/status\n/exit\n`);
    const code = await running;

    expect(code).toBe(0);
    expect(stdout.text()).toContain("CHAT_RESUME_RESULT");
    expect(stderr.text()).toContain(`Thread: ${fixture.threadId}`);
    expect(stderr.text()).toContain("Last Run: run_");
    expect(stderr.text()).toContain(" completed");
  });

  it("keeps command errors local and sends a doubled slash as a prompt", async () => {
    const fixture = await createFixture();
    const provider = fauxProvider({ provider: "interactive-command" });
    let observedMessages = "";
    provider.setResponses([
      (context) => {
        observedMessages = JSON.stringify(context.messages);
        return fauxAssistantMessage("CHAT_LITERAL_SLASH_RESULT");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();
    const input = ttyInput("", false);
    const running = runCli(
      [
        "chat",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--model",
        "interactive-command/faux-1",
      ],
      interactiveIo(fixture.root, input, stdout, stderr),
      providersDependencies([provider]),
    );
    await vi.waitFor(() => expect(stderr.text()).toContain("chat ready"));
    input.end(
      [
        "/model invalid",
        "/thread X",
        "/new <unsafe>",
        "/unknown",
        "//literal prompt",
        "/exit extra",
        "/exit",
      ].join("\n") + "\n",
    );
    const code = await running;

    expect(code).toBe(0);
    expect(stdout.text()).toContain("CHAT_LITERAL_SLASH_RESULT");
    expect(count(stderr.text(), "Interactive command error:")).toBe(5);
    expect(observedMessages).toContain("/literal prompt");
  });

  it("rejects non-TTY input and redacts bootstrap failures before execution", async () => {
    const fixture = await createFixture();
    let bootstraps = 0;
    const nonTtyStderr = new CaptureWritable();
    const nonTtyCode = await runCli(
      ["chat", "--workspace", fixture.workspaceRoot],
      {
        cwd: fixture.root,
        env: {},
        stdin: new PassThrough(),
        stdout: new CaptureWritable(),
        stderr: nonTtyStderr,
      },
      {
        async createRuntime() {
          bootstraps += 1;
          throw new Error("must not bootstrap");
        },
      },
    );
    expect(nonTtyCode).toBe(2);
    expect(bootstraps).toBe(0);
    expect(nonTtyStderr.text()).toContain("requires an interactive TTY");

    const cancelledPrivateError = "PRIVATE_PRE_ABORT_REASON";
    const cancelledController = new AbortController();
    cancelledController.abort(new Error(cancelledPrivateError));
    let cancelledBootstraps = 0;
    const cancelledStderr = new CaptureWritable();
    const cancelledCode = await runCli(
      ["chat", "--workspace", fixture.workspaceRoot],
      interactiveIo(
        fixture.root,
        ttyInput("", false),
        new CaptureWritable(),
        cancelledStderr,
      ),
      {
        async createRuntime() {
          cancelledBootstraps += 1;
          throw new Error("must not bootstrap");
        },
      },
      cancelledController.signal,
    );
    expect(cancelledCode).toBe(1);
    expect(cancelledBootstraps).toBe(0);
    expect(cancelledStderr.text()).toContain("Napier chat failed:");
    expect(cancelledStderr.text()).not.toContain(cancelledPrivateError);

    const privateError = "PRIVATE_INTERACTIVE_BOOTSTRAP";
    const ttyStderr = new CaptureWritable();
    const ttyCode = await runCli(
      ["chat", "--workspace", fixture.workspaceRoot],
      interactiveIo(
        fixture.root,
        ttyInput("", false),
        new CaptureWritable(),
        ttyStderr,
      ),
      {
        async createRuntime() {
          throw new Error(privateError);
        },
      },
    );
    expect(ttyCode).toBe(1);
    expect(ttyStderr.text()).toContain("Napier chat failed:");
    expect(ttyStderr.text()).not.toContain(privateError);
  });

  it("closes the Runtime on EOF, idle interrupt, and parent termination", async () => {
    const fixture = await createFixture();
    let shutdowns = 0;
    const dependencies = shutdownTrackingDependencies(() => {
      shutdowns += 1;
    });

    const eofInput = ttyInput("", false);
    const eofStderr = new CaptureWritable();
    const eofRun = runCli(
      [
        "chat",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
      ],
      interactiveIo(fixture.root, eofInput, new CaptureWritable(), eofStderr),
      dependencies,
    );
    await vi.waitFor(() => expect(eofStderr.text()).toContain("chat ready"));
    eofInput.end();
    expect(await eofRun).toBe(0);
    expect(shutdowns).toBe(1);

    const interruptInput = ttyInput("", false);
    const interruptStderr = new CaptureWritable();
    let interrupt: (() => void) | undefined;
    const interruptRun = runCli(
      [
        "chat",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
      ],
      {
        ...interactiveIo(
          fixture.root,
          interruptInput,
          new CaptureWritable(),
          interruptStderr,
        ),
        subscribeInterrupt(listener) {
          interrupt = listener;
          return () => {
            interrupt = undefined;
          };
        },
      },
      dependencies,
    );
    await vi.waitFor(() =>
      expect(interruptStderr.text()).toContain("chat ready"),
    );
    interrupt?.();

    expect(await interruptRun).toBe(130);
    expect(shutdowns).toBe(2);

    const parentInput = ttyInput("", false);
    const parentStderr = new CaptureWritable();
    const parentController = new AbortController();
    const parentRun = runCli(
      [
        "chat",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
      ],
      interactiveIo(
        fixture.root,
        parentInput,
        new CaptureWritable(),
        parentStderr,
      ),
      dependencies,
      parentController.signal,
    );
    await vi.waitFor(() => expect(parentStderr.text()).toContain("chat ready"));
    parentController.abort();

    expect(await parentRun).toBe(1);
    expect(shutdowns).toBe(3);
  });

  it("times out one turn, records cancellation, and keeps the session usable", async () => {
    const fixture = await createFixture();
    const provider = fauxProvider({ provider: "interactive-timeout" });
    const entered = deferred<void>();
    const release = deferred<void>();
    provider.setResponses([
      async () => {
        entered.resolve();
        await release.promise;
        return fauxAssistantMessage("TIMED_OUT_TEXT_MUST_NOT_COMPLETE");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const input = ttyInput("", false);
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();
    const running = runCli(
      [
        "chat",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--model",
        "interactive-timeout/faux-1",
        "--timeout-ms",
        "1000",
      ],
      interactiveIo(fixture.root, input, stdout, stderr),
      providersDependencies([provider]),
    );
    await vi.waitFor(() => expect(stderr.text()).toContain("chat ready"));
    input.write("Start a turn that times out.\n");
    await entered.promise;
    const releaseTimer = setTimeout(() => release.resolve(), 1_200);
    try {
      await vi.waitFor(
        () => expect(stderr.text()).toContain("timed out after 1000 ms"),
        { timeout: 5_000 },
      );
      input.end("/status\n/exit\n");

      expect(await running).toBe(0);
      expect(stdout.text()).not.toContain("TIMED_OUT_TEXT_MUST_NOT_COMPLETE");
      expect(stderr.text()).toContain("Last Run: run_");
      expect(stderr.text()).toContain(" cancelled");
    } finally {
      clearTimeout(releaseTimer);
      release.resolve();
    }
  });

  it("fails closed and redacts a broken interactive output channel", async () => {
    const fixture = await createFixture();
    const provider = fauxProvider({ provider: "interactive-output" });
    provider.setResponses([
      fauxAssistantMessage("OUTPUT_FAILURE_RESULT"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const privateError = "PRIVATE_INTERACTIVE_OUTPUT_FAILURE";
    const input = ttyInput("", false);
    const stdout = new CaptureWritable();
    vi.spyOn(stdout, "write").mockImplementation(() => {
      throw new Error(privateError);
    });
    const stderr = new CaptureWritable();
    let shutdowns = 0;
    const running = runCli(
      [
        "chat",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--model",
        "interactive-output/faux-1",
      ],
      interactiveIo(fixture.root, input, stdout, stderr),
      providersDependencies([provider], undefined, () => {
        shutdowns += 1;
      }),
    );
    await vi.waitFor(() => expect(stderr.text()).toContain("chat ready"));
    input.end("Trigger output failure.\n");

    expect(await running).toBe(1);
    expect(shutdowns).toBe(1);
    expect(stderr.text()).toContain("Napier chat failed:");
    expect(stderr.text()).not.toContain(privateError);
  });

  it("isolates a private Provider failure and continues the same Thread", async () => {
    const fixture = await createFixture();
    const provider = fauxProvider({ provider: "interactive-failure" });
    const privateError = "PRIVATE_INTERACTIVE_PROVIDER_FAILURE";
    provider.setResponses([
      () => {
        throw new Error(privateError);
      },
      fauxAssistantMessage(
        "RECOVERED_AFTER_PROVIDER_FAILURE\u001b]52;c;CLIPBOARD\u0007\u202e",
      ),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const input = ttyInput("", false);
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();
    const running = runCli(
      [
        "chat",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--model",
        "interactive-failure/faux-1",
        "--title",
        "Provider failure recovery",
      ],
      interactiveIo(fixture.root, input, stdout, stderr),
      providersDependencies([provider]),
    );
    await vi.waitFor(() => expect(stderr.text()).toContain("chat ready"));
    input.end(
      "Fail this turn without ending the session.\nRecover on this Thread.\n/exit\n",
    );

    expect(await running).toBe(0);
    expect(stdout.text()).toContain("RECOVERED_AFTER_PROVIDER_FAILURE");
    expect(stdout.text()).toContain("\\u001b]52;c;CLIPBOARD\\u0007\\u202e");
    expect(stdout.text()).not.toContain("\u001b");
    expect(stdout.text()).not.toContain("\u0007");
    expect(stdout.text()).not.toContain("\u202e");
    expect(stderr.text()).toContain(" failed (thread ");
    expect(stderr.text()).not.toContain(privateError);

    const reopened = await createLocalAgentRuntime({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("interactive-failure-inspect"),
    });
    const thread = reopened.store
      .listThreads()
      .find((candidate) => candidate.title === "Provider failure recovery");
    expect(thread).toBeDefined();
    expect(
      reopened.store
        .listRuns(thread!.id)
        .map((run) => run.status)
        .sort(),
    ).toEqual(["completed", "failed"]);
    await reopened.shutdown();
  });

  it("cancels an active turn on interrupt and remains usable", async () => {
    const fixture = await createFixture();
    const provider = fauxProvider({ provider: "interactive-cancel" });
    const entered = deferred<void>();
    const release = deferred<void>();
    provider.setResponses([
      async () => {
        entered.resolve();
        await release.promise;
        return fauxAssistantMessage("CANCELLED_TEXT_MUST_NOT_COMPLETE");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const input = ttyInput("", false);
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();
    let interrupt: (() => void) | undefined;
    const running = runCli(
      [
        "chat",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--model",
        "interactive-cancel/faux-1",
      ],
      {
        ...interactiveIo(fixture.root, input, stdout, stderr),
        subscribeInterrupt(listener) {
          interrupt = listener;
          return () => {
            interrupt = undefined;
          };
        },
      },
      providersDependencies([provider]),
    );
    await vi.waitFor(() => expect(stderr.text()).toContain("chat ready"));
    input.write("Start a cancellable turn.\n");
    await entered.promise;
    interrupt?.();
    release.resolve();
    await vi.waitFor(() => {
      expect(stderr.text()).toContain("cancelled");
    });
    input.end("/status\n/exit\n");

    expect(await running).toBe(0);
    expect(stderr.text()).toContain("^C cancelling active Run");
    expect(stderr.text()).toContain("Last Run: run_");
    expect(stderr.text()).toContain(" cancelled");
  });

  const describeBuiltTerminal = process.platform === "win32" ? it.skip : it;

  describeBuiltTerminal(
    "runs the built CLI for two durable turns in a real PTY",
    async () => {
      const fixture = await createFixture();
      const entrypoint = path.resolve(import.meta.dirname, "../dist/index.js");
      let output = "";
      let exited = false;
      const terminal = spawnTerminal(
        process.execPath,
        [
          entrypoint,
          "chat",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--model",
          "napier/demo",
          "--title",
          "Built PTY interactive thread",
        ],
        {
          name: "xterm-256color",
          cols: 100,
          rows: 30,
          cwd: fixture.root,
          env: terminalEnvironment(),
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
        await vi.waitFor(() => expect(output).toContain("Napier chat ready"), {
          timeout: 5_000,
        });
        terminal.write("First built PTY turn.\r");
        await vi.waitFor(
          () => {
            expect(output).toContain("First built PTY turn.");
            expect(count(output, "Napier run run_")).toBe(1);
          },
          { timeout: 10_000 },
        );
        terminal.write("/model napier/demo\r");
        terminal.write("Second built PTY turn.\r");
        await vi.waitFor(
          () => {
            expect(output).toContain("Model: napier/demo");
            expect(output).toContain("Second built PTY turn.");
            expect(count(output, "Napier run run_")).toBe(2);
          },
          { timeout: 10_000 },
        );
        terminal.write("/status\r");
        await vi.waitFor(
          () => {
            expect(output).toContain("Last Run: run_");
            expect(output).toContain(" completed");
          },
          { timeout: 5_000 },
        );
        terminal.write("/exit\r");

        expect(await exit).toBe(0);
      } finally {
        dataSubscription.dispose();
        if (!exited) terminal.kill();
      }

      expect(output).not.toContain("requires an interactive TTY");
      const runThreads = [
        ...output.matchAll(
          /Napier run run_[a-z0-9_-]+ completed \(thread ([a-z0-9_]+)\)/gu,
        ),
      ].map((match) => match[1]);
      expect(runThreads).toHaveLength(2);
      expect(new Set(runThreads).size).toBe(1);

      const reopened = await createLocalAgentRuntime({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        sandbox: new UnsupportedSandboxAdapter("interactive-built-inspect"),
      });
      const thread = reopened.store
        .listThreads()
        .find(
          (candidate) => candidate.title === "Built PTY interactive thread",
        );
      expect(thread).toBeDefined();
      expect(
        reopened.store
          .listRuns(thread!.id)
          .filter((run) => run.status === "completed"),
      ).toHaveLength(2);
      await reopened.shutdown();
    },
    30_000,
  );
});

async function createFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-interactive-test-"));
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
        sandbox: new UnsupportedSandboxAdapter("interactive-test"),
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

function shutdownTrackingDependencies(
  onShutdown: () => void,
): RunCliDependencies {
  return providersDependencies([], undefined, onShutdown);
}

function interactiveIo(
  cwd: string,
  stdin: PassThrough,
  stdout: Writable,
  stderr: Writable,
): CliIo {
  return { cwd, env: {}, stdin, stdout, stderr };
}

function ttyInput(text: string, end = true): PassThrough {
  const input = new PassThrough();
  Object.defineProperty(input, "isTTY", { value: true });
  queueMicrotask(() => {
    if (end) input.end(text);
    else if (text) input.write(text);
  });
  return input;
}

function count(text: string, value: string): number {
  return text.split(value).length - 1;
}

function terminalEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
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

class CaptureWritable extends Writable {
  private readonly chunks: string[] = [];

  constructor(private readonly delayMs = 0) {
    super({ highWaterMark: 1 });
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString("utf8"));
    if (this.delayMs > 0) setTimeout(callback, this.delayMs);
    else callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}
