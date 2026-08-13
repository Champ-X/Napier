import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";

import { canonicalJson, LocalStore, sha256 } from "@napier/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseCliArgs, runCli } from "../src/cli.js";
import { subscribeBrowserTaskControls } from "../src/browser-task-control-cli.js";
import type { CliIo, RunCliDependencies } from "../src/cli-runtime.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Browser Use local CLI", () => {
  it("accepts an explicit local backend, model, optional credential override, and domain boundary", () => {
    expect(
      parseCliArgs([
        "browser-task",
        "--workspace",
        ".",
        "--backend",
        "browser_use_local",
        "--task",
        "Read both example pages",
        "--start-url",
        "https://example.com/",
        "--model",
        "openai/gpt-5-mini",
        "--credential-env",
        "OPENAI_API_KEY",
        "--allowed-domains",
        "example.com,*.example.org",
        "--max-steps",
        "12",
        "--timeout-ms",
        "60000",
        "--jsonl",
      ]),
    ).toEqual({
      kind: "browser-task",
      options: {
        workspace: ".",
        backend: "browser_use_local",
        task: "Read both example pages",
        startUrl: "https://example.com/",
        model: { provider: "openai", id: "gpt-5-mini" },
        credentialEnv: "OPENAI_API_KEY",
        allowedDomains: ["example.com", "*.example.org"],
        maxSteps: 12,
        maxCostUsd: 1,
        timeoutMs: 60_000,
        jsonl: true,
      },
    });
    expect(() =>
      parseCliArgs([
        "browser-task",
        "--workspace",
        ".",
        "--backend",
        "native_playwright",
        "--task",
        "test",
        "--model",
        "openai/gpt-5-mini",
        "--credential-env",
        "OPENAI_API_KEY",
        "--allowed-domains",
        "example.com",
      ]),
    ).toThrow("native_playwright remains the default");
  });

  it("uses the active stored provider credential when no environment override is supplied", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();
    const shutdown = vi.fn(async () => undefined);
    const createRuntime = vi.fn(
      async () =>
        ({
          credentials: { read: vi.fn(async () => undefined) },
          shutdown,
        }) as never,
    );

    expect(
      parseCliArgs([
        "browser-task",
        "--workspace",
        fixture.workspace,
        "--backend",
        "browser_use_local",
        "--task",
        "Read example.com",
        "--model",
        "deepseek/deepseek-chat",
        "--allowed-domains",
        "example.com",
        "--jsonl",
      ]),
    ).toEqual(
      expect.objectContaining({
        kind: "browser-task",
        options: expect.not.objectContaining({
          credentialEnv: expect.anything(),
        }),
      }),
    );

    const code = await runCli(
      [
        "browser-task",
        "--workspace",
        fixture.workspace,
        "--backend",
        "browser_use_local",
        "--task",
        "Read example.com",
        "--model",
        "deepseek/deepseek-chat",
        "--allowed-domains",
        "example.com",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, new CaptureWritable()),
      { createRuntime },
    );

    expect(code).toBe(1);
    expect(createRuntime).toHaveBeenCalledOnce();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(JSON.parse(stdout.text())).toMatchObject({
      code: "credential_missing",
      recovery: expect.stringContaining("Context → Credentials"),
    });
    expect(stdout.text()).not.toContain("undefined");
  });

  it("resolves a real stored environment reference before the local backend readiness check", async () => {
    const fixture = await createFixture();
    const dataRoot = path.join(fixture.workspace, ".napier");
    const store = new LocalStore({
      workspaceRoot: fixture.workspace,
      dataRoot,
    });
    await store.initialize();
    await store.createCredentialReference({
      providerId: "deepseek",
      label: "CLI DeepSeek reference",
      source: {
        type: "environment",
        variable: "NAPIER_CLI_REFERENCE_KEY",
      },
    });
    store.close();
    const stdout = new CaptureWritable();

    const code = await runCli(
      [
        "browser-task",
        "--workspace",
        fixture.workspace,
        "--backend",
        "browser_use_local",
        "--task",
        "Read example.com",
        "--model",
        "deepseek/deepseek-chat",
        "--allowed-domains",
        "example.com",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, new CaptureWritable(), {
        NAPIER_CLI_REFERENCE_KEY: "private-cli-reference",
        PATH: process.env.PATH,
      }),
    );

    expect(code).toBe(1);
    expect(JSON.parse(stdout.text())).toMatchObject({
      kind: "napier.browser-task-error",
      code: "backend_missing",
    });
    expect(stdout.text()).not.toContain("private-cli-reference");
    expect(stdout.text()).not.toContain("NAPIER_CLI_REFERENCE_KEY");
  });

  it("rejects a deterministic start page outside the domain boundary", () => {
    expect(() =>
      parseCliArgs([
        "browser-task",
        "--workspace",
        ".",
        "--backend",
        "browser_use_local",
        "--task",
        "Read a page",
        "--start-url",
        "https://outside.example/",
        "--model",
        "openai/gpt-5-mini",
        "--credential-env",
        "OPENAI_API_KEY",
        "--allowed-domains",
        "example.com",
      ]),
    ).toThrow("match --allowed-domains");
  });

  it("previews and exact-applies the pinned first-party runtime", async () => {
    const fixture = await createFixture();
    const dependencies: RunCliDependencies = {
      createRuntime: vi.fn(),
      browserUseLocalSetup: {
        uvExecutable: "uv",
        runProcess: vi.fn(),
      },
    };
    dependencies.browserUseLocalSetup = {
      ...dependencies.browserUseLocalSetup,
      // Inspection sees no managed runtime in the fresh fixture and a working uv.
      runProcess: async (request) => {
        if (request.args[0] === "--version") {
          return processResult("uv 0.11.28\n");
        }
        return processResult("");
      },
    };
    const stdout = new CaptureWritable();
    const code = await runCli(
      [
        "setup",
        "--workspace",
        fixture.workspace,
        "--component",
        "browser-use-local",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, new CaptureWritable()),
      dependencies,
    );
    expect(code).toBe(0);
    const preview = JSON.parse(stdout.text()) as Record<string, unknown>;
    expect(preview).toEqual(
      expect.objectContaining({
        kind: "napier.browser-use-local-setup-preview",
        backend: "browser_use_local",
        status: "installable",
        packageName: "browser-use",
        packageVersion: "0.13.7",
      }),
    );
    const { contentSha256, ...content } = preview;
    expect(contentSha256).toBe(sha256(canonicalJson(content as never)));
  });

  it("fails safely before backend launch when the credential locator is empty", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();
    const code = await runCli(
      [
        "browser-task",
        "--workspace",
        fixture.workspace,
        "--backend",
        "browser_use_local",
        "--task",
        "Read example.com",
        "--model",
        "openai/gpt-5-mini",
        "--credential-env",
        "MISSING_BROWSER_KEY",
        "--allowed-domains",
        "example.com",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, new CaptureWritable()),
      { createRuntime: vi.fn() },
    );
    expect(code).toBe(1);
    expect(JSON.parse(stdout.text())).toEqual(
      expect.objectContaining({
        kind: "napier.browser-task-error",
        backend: "browser_use_local",
        code: "credential_missing",
        recovery: expect.stringContaining("MISSING_BROWSER_KEY"),
      }),
    );
    expect(stdout.text()).not.toContain("undefined");
  });

  it("accepts an explicitly selected configured DeepSeek backend model", () => {
    expect(
      parseCliArgs([
        "browser-task",
        "--workspace",
        ".",
        "--backend",
        "browser_use_local",
        "--task",
        "Read example.com",
        "--model",
        "deepseek/deepseek-chat",
        "--credential-env",
        "DEEPSEEK_API_KEY",
        "--allowed-domains",
        "example.com",
      ]),
    ).toEqual(
      expect.objectContaining({
        kind: "browser-task",
        options: expect.objectContaining({
          model: { provider: "deepseek", id: "deepseek-chat" },
          credentialEnv: "DEEPSEEK_API_KEY",
        }),
      }),
    );
  });

  it("maps CLI pause, takeover, resume, and stop lines to the live local backend", async () => {
    const stdin = new PassThrough();
    const states: string[] = [];
    let stopped: () => void = () => undefined;
    const didStop = new Promise<void>((resolve) => {
      stopped = resolve;
    });
    const observation = (state: "running" | "paused" | "takeover") => ({
      type: "control" as const,
      backend: "browser_use_local" as const,
      state,
      pauseAvailable: true,
      takeoverAvailable: true,
      browserVisibility: "visible" as const,
      message: `Agent ${state}`,
    });
    const unsubscribe = subscribeBrowserTaskControls({
      stdin,
      backend: {
        pause: () => observation("paused"),
        takeover: () => observation("takeover"),
        resume: () => observation("running"),
      },
      stop: stopped,
      observe: async (event) => {
        states.push(event.state);
      },
      invalid: async () => undefined,
      failed: async (error) => {
        throw error;
      },
    });

    stdin.end("pause\ntakeover\nresume\nstop\n");
    await didStop;
    unsubscribe?.();
    expect(states).toEqual(["paused", "takeover", "running"]);
  });

  it("requires explicit Cloud data, model, and cost choices", () => {
    expect(
      parseCliArgs([
        "browser-task",
        "--workspace",
        ".",
        "--backend",
        "browser_use_cloud",
        "--task",
        "Read the release page",
        "--start-url",
        "https://example.com/releases",
        "--model",
        "browser-use/browser-use-2.0",
        "--credential-env",
        "BROWSER_USE_API_KEY",
        "--allowed-domains",
        "example.com",
        "--max-cost-usd",
        "0.75",
      ]),
    ).toEqual(
      expect.objectContaining({
        kind: "browser-task",
        options: expect.objectContaining({
          backend: "browser_use_cloud",
          startUrl: "https://example.com/releases",
          model: { provider: "browser-use", id: "browser-use-2.0" },
          maxCostUsd: 0.75,
        }),
      }),
    );
    expect(() =>
      parseCliArgs([
        "browser-task",
        "--workspace",
        ".",
        "--backend",
        "browser_use_cloud",
        "--task",
        "Read the release page",
        "--start-url",
        "https://example.com/releases",
        "--model",
        "browser-use/browser-use-2.0",
        "--credential-env",
        "BROWSER_USE_API_KEY",
        "--allowed-domains",
        "example.com",
      ]),
    ).toThrow("explicit --max-cost-usd");
  });
});

function processResult(stdout: string) {
  return {
    exitCode: 0,
    stdout,
    outputBytes: Buffer.byteLength(stdout),
    outputSha256: sha256(stdout),
  };
}

async function createFixture(): Promise<{ root: string; workspace: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-browser-use-test-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  return { root, workspace };
}

function cliIo(
  cwd: string,
  stdout: Writable,
  stderr: Writable,
  env: Readonly<Record<string, string | undefined>> = {},
): CliIo {
  return { cwd, env, stdout, stderr };
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
