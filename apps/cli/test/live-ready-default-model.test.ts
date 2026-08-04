import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
  createLocalAgentRuntime,
  UnsupportedSandboxAdapter,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli, type CliIo, type RunCliDependencies } from "../src/cli.js";

const roots: string[] = [];
const SECRET = "PRIVATE_LIVE_READY_DEFAULT_KEY";
const ENV_NAME = "LIVE_READY_DEFAULT_KEY";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("live-ready default model entries", () => {
  it("uses the registered model on a later one-shot Run without flags", async () => {
    const fixture = await createFixture();
    const provider = responses("cli-live-ready", [
      "CLI_BOOTSTRAP_OK",
      "CLI_DEFAULT_OK",
    ]);
    const dependencies = providersDependencies([provider]);
    await bootstrap("run", fixture, dependencies, provider.provider.id);
    const stdout = new CaptureWritable();

    const code = await runCli(
      [
        "run",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--prompt",
        "Use the default model.",
        "--jsonl",
      ],
      io(fixture.root, stdout),
      dependencies,
    );

    expect(code).toBe(0);
    expect(stdout.text()).toContain('"provider":"cli-live-ready"');
    expect(stdout.text()).toContain("CLI_DEFAULT_OK");
    expect(stdout.text()).not.toContain(SECRET);
    await expectSeedAgentUnchanged(fixture);
  });

  it("shows and uses the registered model when Chat omits --model", async () => {
    const fixture = await createFixture();
    const provider = responses("chat-live-ready", [
      "CHAT_BOOTSTRAP_OK",
      "CHAT_DEFAULT_OK",
    ]);
    const dependencies = providersDependencies([provider]);
    await bootstrap("run", fixture, dependencies, provider.provider.id);
    const input = ttyInput("/model\nUse the default.\n/exit\n");
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();

    const code = await runCli(
      [
        "chat",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
      ],
      {
        ...io(fixture.root, stdout, stderr),
        stdin: input,
      },
      dependencies,
    );

    expect(code).toBe(0);
    expect(stderr.text()).toContain("Model: chat-live-ready/faux-1");
    expect(stdout.text()).toContain("CHAT_DEFAULT_OK");
    expect(`${stdout.text()}${stderr.text()}`).not.toContain(SECRET);
  });

  it("shows and uses the registered model when TUI omits --model", async () => {
    const fixture = await createFixture();
    const provider = responses("tui-live-ready", [
      "TUI_BOOTSTRAP_OK",
      "TUI_DEFAULT_OK",
    ]);
    const dependencies = providersDependencies([provider]);
    await bootstrap("run", fixture, dependencies, provider.provider.id);
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
      ],
      {
        ...io(fixture.root, stdout, stderr),
        stdin: input,
      },
      dependencies,
    );
    await vi.waitFor(
      () => expect(stdout.lastFrame()).toContain("Ready; type a prompt"),
      { timeout: 5_000 },
    );
    expect(stdout.lastFrame()).toContain("model tui-live-ready/faux-1");
    input.write("Use the default.\r");
    await vi.waitFor(
      () => {
        expect(stdout.lastFrame()).toContain("TUI_DEFAULT_OK");
        expect(stdout.lastFrame()).toMatch(/Run run_[a-z0-9_-]+ completed/u);
      },
      {
        timeout: 10_000,
      },
    );
    input.write("/exit\r");

    expect(await running).toBe(0);
    expect(stdout.text()).not.toContain(SECRET);
    expect(stderr.text()).not.toContain(SECRET);
  });
});

async function bootstrap(
  command: "run",
  fixture: Fixture,
  dependencies: RunCliDependencies,
  provider: string,
): Promise<void> {
  const code = await runCli(
    [
      command,
      "--workspace",
      fixture.workspaceRoot,
      "--data-root",
      fixture.dataRoot,
      "--prompt",
      "Bootstrap the explicit locator.",
      "--model",
      `${provider}/faux-1`,
      "--credential-env",
      ENV_NAME,
      "--jsonl",
    ],
    io(fixture.root, new CaptureWritable()),
    dependencies,
  );
  expect(code).toBe(0);
}

async function expectSeedAgentUnchanged(fixture: Fixture): Promise<void> {
  const services = await createLocalAgentRuntime({
    workspaceRoot: fixture.workspaceRoot,
    dataRoot: fixture.dataRoot,
    env: { [ENV_NAME]: SECRET },
    sandbox: new UnsupportedSandboxAdapter("live-ready-inspection"),
  });
  try {
    expect(services.store.listAgents()[0]?.model).toEqual({
      provider: "napier",
      id: "demo",
    });
    expect(services.store.listAgentRevisions("agent_napier")).toHaveLength(1);
  } finally {
    await services.shutdown();
  }
}

function providersDependencies(
  providers: Array<ReturnType<typeof fauxProvider>>,
): RunCliDependencies {
  return {
    async createRuntime(options: LocalAgentRuntimeOptions) {
      const services = await createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("live-ready-default-test"),
      });
      for (const provider of providers) {
        services.models.registerProvider(provider.provider);
      }
      return services;
    },
  };
}

function responses(provider: string, texts: string[]) {
  const result = fauxProvider({ provider });
  result.setResponses(
    texts.flatMap((text) => [
      fauxAssistantMessage(text),
      fauxAssistantMessage('{"facts":[]}'),
    ]),
  );
  return result;
}

interface Fixture {
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-live-ready-default-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  return { root, workspaceRoot, dataRoot: path.join(root, "state") };
}

function io(
  cwd: string,
  stdout: Writable,
  stderr: Writable = new CaptureWritable(),
): CliIo {
  return {
    cwd,
    env: { [ENV_NAME]: SECRET },
    stdout,
    stderr,
  };
}

function ttyInput(text: string): PassThrough {
  const input = new PassThrough();
  Object.defineProperty(input, "isTTY", { value: true });
  queueMicrotask(() => input.end(text));
  return input;
}

class RawTtyInput extends PassThrough {
  readonly isTTY = true;
  isRaw = false;

  setRawMode(enabled: boolean): void {
    this.isRaw = enabled;
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

class TtyCapture extends CaptureWritable {
  readonly isTTY = true;
  readonly columns = 100;
  readonly rows = 30;

  lastFrame(): string {
    return this.text().split("\u001b[H\u001b[2J").at(-1) ?? "";
  }
}
