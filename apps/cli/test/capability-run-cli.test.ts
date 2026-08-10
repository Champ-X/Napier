import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { agentCapabilityPresetUpdate } from "@napier/contracts/agent-capabilities";
import {
  createLocalAgentRuntime,
  UnsupportedSandboxAdapter,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseCliArgs, runCli, type RunCliDependencies } from "../src/cli.js";
import { assertCliResumeReadiness } from "../src/cli-run-readiness.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("temporary capability preset CLI", () => {
  it("parses strict Run, Chat, and TUI preset options", () => {
    expect(
      parseCliArgs([
        "run",
        "--workspace",
        ".",
        "--prompt",
        "Research this.",
        "--preset",
        "research",
      ]),
    ).toEqual(
      expect.objectContaining({
        kind: "run",
        options: expect.objectContaining({ capabilityPreset: "research" }),
      }),
    );
    for (const command of ["chat", "tui"] as const) {
      expect(
        parseCliArgs([
          command,
          "--workspace",
          ".",
          "--preset",
          "safe_automation",
        ]),
      ).toEqual(
        expect.objectContaining({
          kind: command,
          options: expect.objectContaining({
            capabilityPreset: "safe_automation",
          }),
        }),
      );
    }
    expect(() =>
      parseCliArgs([
        "run",
        "--workspace",
        ".",
        "--prompt",
        "No implicit policy.",
        "--preset",
        "unrestricted",
      ]),
    ).toThrow(
      "--preset must be one of coding, research, data, browser, safe_automation",
    );
  });

  it("advertises one-use Browser confirmation in Chat status", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-chat-safe-status-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const stdin = ttyInput();
    const stderr = new CaptureWritable();
    const running = runCli(
      ["chat", "--workspace", workspaceRoot, "--preset", "safe_automation"],
      {
        cwd: root,
        env: {},
        stdin,
        stdout: new CaptureWritable(),
        stderr,
      },
      dependencies(),
    );
    await vi.waitFor(() => expect(stderr.text()).toContain("chat ready"));
    stdin.end("/status\n/exit\n");

    expect(await running).toBe(0);
    expect(stderr.text()).toContain(
      "Capabilities: Safe Automation / Workspace changes / browser read / interact confirm",
    );
  });

  it("runs the default one-shot entry with a non-persistent Browser preset", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-cli-run-preset-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();

    const code = await runCli(
      [
        "run",
        "--workspace",
        workspaceRoot,
        "--data-root",
        dataRoot,
        "--prompt",
        "Report the active capability boundary.",
        "--preset",
        "browser",
        "--jsonl",
      ],
      { cwd: root, env: {}, stdout, stderr },
      dependencies(),
    );

    expect(code, stderr.text()).toBe(0);
    expect(stdout.text()).toContain('"type":"done"');
    const reopened = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      sandbox: new UnsupportedSandboxAdapter("cli-run-preset-inspect"),
    });
    try {
      const agent = reopened.store.listAgents()[0]!;
      const thread = reopened.store
        .listThreads()
        .find((candidate) => candidate.title === "CLI one-shot");
      expect(thread).toBeDefined();
      const run = reopened.store.listRuns(thread!.id)[0]!;
      const browser = agentCapabilityPresetUpdate("browser");
      expect(run.configuration).toEqual(
        expect.objectContaining({
          toolPolicy: "observe",
          enabledTools: [...browser.enabledTools].sort(),
          enabledSkills: [...browser.enabledSkills].sort(),
          enabledSubagents: [...browser.enabledSubagents].sort(),
        }),
      );
      expect(reopened.store.listAgentRevisions(agent.id)).toHaveLength(1);
      expect(agent.enabledTools).not.toEqual(browser.enabledTools);
      expect(
        (await reopened.store.listEvents(thread!.id)).find(
          (event) => event.runId === run.id && event.type === "run.started",
        )?.payload,
      ).toEqual(expect.objectContaining({ capabilityPreset: "browser" }));
    } finally {
      await reopened.shutdown();
    }
  });

  it("blocks process presets before one-shot model, credential, Thread, or Run mutation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-cli-run-gate-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const provider = fauxProvider({ provider: "run-gate" });
    provider.setResponses([fauxAssistantMessage("MUST_NOT_RUN")]);
    const stderr = new CaptureWritable();

    const code = await runCli(
      [
        "run",
        "--workspace",
        workspaceRoot,
        "--data-root",
        dataRoot,
        "--model",
        "run-gate/faux-1",
        "--credential-env",
        "RUN_GATE_KEY",
        "--prompt",
        "Modify the workspace.",
        "--preset",
        "coding",
      ],
      {
        cwd: root,
        env: { RUN_GATE_KEY: "PRIVATE_RUN_GATE_KEY" },
        stdout: new CaptureWritable(),
        stderr,
      },
      dependencies(provider),
    );

    expect(code).toBe(1);
    expect(provider.state.callCount).toBe(0);
    expect(stderr.text()).toContain("requires a supported process Sandbox");
    expect(stderr.text()).toContain("--component sandbox");
    expect(stderr.text()).not.toContain("PRIVATE_RUN_GATE_KEY");

    const reopened = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: { RUN_GATE_KEY: "PRIVATE_RUN_GATE_KEY" },
      sandbox: new UnsupportedSandboxAdapter("run-gate-inspect"),
    });
    try {
      expect(reopened.store.listThreads()).toHaveLength(1);
      expect(reopened.store.listCredentialReferences()).toEqual([]);
      expect(
        reopened.store
          .listThreads()
          .flatMap((thread) => reopened.store.listRuns(thread.id)),
      ).toHaveLength(1);
    } finally {
      await reopened.shutdown();
    }
  });

  it("uses and reports the temporary preset for each Chat turn", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-chat-preset-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const provider = fauxProvider({ provider: "chat-preset" });
    provider.setResponses([
      fauxAssistantMessage("CHAT_PRESET_RESULT"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const stdin = ttyInput();
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();
    const running = runCli(
      [
        "chat",
        "--workspace",
        workspaceRoot,
        "--data-root",
        dataRoot,
        "--model",
        "chat-preset/faux-1",
        "--preset",
        "browser",
      ],
      { cwd: root, env: {}, stdin, stdout, stderr },
      dependencies(provider),
    );
    await vi.waitFor(() => expect(stderr.text()).toContain("chat ready"));
    stdin.end("/status\nUse the temporary Browser preset.\n/exit\n");

    expect(await running).toBe(0);
    expect(stdout.text()).toContain("CHAT_PRESET_RESULT");
    expect(stderr.text()).toContain(
      "Capabilities: Browser / Read only / browser read / interact no",
    );
    const reopened = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      sandbox: new UnsupportedSandboxAdapter("chat-preset-inspect"),
    });
    try {
      const thread = reopened.store
        .listThreads()
        .find((candidate) => candidate.title === "SDK Agent run");
      expect(thread).toBeDefined();
      expect(reopened.store.listRuns(thread!.id)[0]?.configuration).toEqual(
        expect.objectContaining({
          enabledTools: [
            ...agentCapabilityPresetUpdate("browser").enabledTools,
          ].sort(),
        }),
      );
      expect(reopened.store.listAgentRevisions(thread!.agentId)).toHaveLength(
        1,
      );
    } finally {
      await reopened.shutdown();
    }
  });

  it("keeps Chat available but blocks a process preset before creating a Run", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-chat-run-gate-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const input = ttyInput();
    const stderr = new CaptureWritable();
    const running = runCli(
      [
        "chat",
        "--workspace",
        workspaceRoot,
        "--data-root",
        dataRoot,
        "--preset",
        "coding",
      ],
      {
        cwd: root,
        env: {},
        stdin: input,
        stdout: new CaptureWritable(),
        stderr,
      },
      dependencies(),
    );
    await vi.waitFor(() => expect(stderr.text()).toContain("chat ready"));
    input.end("Modify the workspace.\n/exit\n");

    expect(await running).toBe(0);
    expect(stderr.text()).toContain("requires a supported process Sandbox");
    expect(stderr.text()).toContain("--component sandbox");
    const reopened = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      sandbox: new UnsupportedSandboxAdapter("chat-run-gate-inspect"),
    });
    try {
      expect(reopened.store.listThreads()).toHaveLength(1);
      expect(
        reopened.store
          .listThreads()
          .flatMap((thread) => reopened.store.listRuns(thread.id)),
      ).toHaveLength(1);
    } finally {
      await reopened.shutdown();
    }
  });

  it("blocks recovery from a frozen Coding Run while allowing frozen Research", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-resume-gate-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      sandbox: new UnsupportedSandboxAdapter("resume-gate-test"),
    });
    try {
      const agent = services.store.listAgents()[0]!;
      const codingThread = await services.store.createThread({
        title: "Coding recovery",
        agentId: agent.id,
      });
      const coding = await services.store.createRun({
        threadId: codingThread.id,
        agentId: agent.id,
        capabilityPreset: "coding",
      });
      await services.store.finishRun(coding.id, "interrupted");

      await expect(
        assertCliResumeReadiness(services, codingThread.id, coding.id),
      ).rejects.toThrow("Sandbox is unavailable");

      const researchThread = await services.store.createThread({
        title: "Research recovery",
        agentId: agent.id,
      });
      const research = await services.store.createRun({
        threadId: researchThread.id,
        agentId: agent.id,
        capabilityPreset: "research",
      });
      await services.store.finishRun(research.id, "interrupted");

      await expect(
        assertCliResumeReadiness(services, researchThread.id, research.id),
      ).resolves.toBeUndefined();
    } finally {
      await services.shutdown();
    }
  });
});

function dependencies(
  provider?: ReturnType<typeof fauxProvider>,
): RunCliDependencies {
  return {
    async createRuntime(options: LocalAgentRuntimeOptions) {
      const services = await createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("cli-run-preset-test"),
      });
      if (provider) services.models.registerProvider(provider.provider);
      return services;
    },
  };
}

function ttyInput(): PassThrough {
  const input = new PassThrough();
  Object.defineProperty(input, "isTTY", { value: true });
  return input;
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
