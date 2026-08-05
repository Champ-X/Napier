import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalAgentRuntime,
  type BrowserRuntimeBinding,
} from "@napier/runtime";
import {
  inspectPinnedBrowserRuntime,
  type PinnedBrowserRuntimeInspection,
} from "@napier/runtime/browser-runtime-setup";

import { parseCliArgs, runCli } from "../src/cli.js";
import type { CliIo } from "../src/cli-runtime.js";

const roots: string[] = [];
const SECRET = "cli-provider-setup-secret-never-print";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier setup CLI", () => {
  it("parses preview and exact-hash apply options", () => {
    expect(
      parseCliArgs([
        "setup",
        "--workspace",
        ".",
        "--data-root",
        ".napier-test",
        "--jsonl",
      ]),
    ).toEqual({
      kind: "setup",
      options: {
        workspace: ".",
        dataRoot: ".napier-test",
        apply: false,
        jsonl: true,
      },
    });
    expect(
      parseCliArgs([
        "setup",
        "--workspace",
        ".",
        "--provider",
        "DeepSeek",
        "--expected-preview",
        "a".repeat(64),
        "--apply",
      ]),
    ).toEqual({
      kind: "setup",
      options: {
        workspace: ".",
        providerId: "deepseek",
        expectedPreviewSha256: "a".repeat(64),
        apply: true,
        jsonl: false,
      },
    });
    expect(
      parseCliArgs([
        "setup",
        "--workspace",
        ".",
        "--component",
        "browser",
        "--timeout-ms",
        "120000",
        "--jsonl",
      ]),
    ).toEqual({
      kind: "setup",
      options: {
        workspace: ".",
        component: "browser",
        timeoutMs: 120_000,
        apply: false,
        jsonl: true,
      },
    });
    expect(
      parseCliArgs([
        "setup",
        "--workspace",
        ".",
        "--component",
        "browser",
        "--expected-preview",
        "b".repeat(64),
        "--apply",
      ]),
    ).toEqual({
      kind: "setup",
      options: {
        workspace: ".",
        component: "browser",
        timeoutMs: 300_000,
        expectedPreviewSha256: "b".repeat(64),
        apply: true,
        jsonl: false,
      },
    });
    expect(() =>
      parseCliArgs(["setup", "--workspace", ".", "--apply"]),
    ).toThrow("--apply requires --provider and --expected-preview");
    expect(() =>
      parseCliArgs([
        "setup",
        "--workspace",
        ".",
        "--component",
        "browser",
        "--provider",
        "deepseek",
      ]),
    ).toThrow("--component and --provider are mutually exclusive");
    expect(() =>
      parseCliArgs([
        "setup",
        "--workspace",
        ".",
        "--component",
        "browser",
        "--data-root",
        ".napier",
      ]),
    ).toThrow("--data-root is unavailable for Browser setup");
    expect(parseCliArgs(["setup", "--help"])).toEqual({ kind: "help" });
  });

  it("previews then explicitly enables the same locator without creating a Thread", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-setup-cli-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    const dataRoot = path.join(root, "data");
    await mkdir(workspace);
    const env = { DEEPSEEK_API_KEY: SECRET };
    const baseline = await createLocalAgentRuntime({
      workspaceRoot: workspace,
      dataRoot,
      env,
    });
    const beforeThreads = baseline.store.listThreads();
    const beforeAgent = baseline.store.listAgents()[0]!;
    const beforeRevisionCount = baseline.store.listAgentRevisions(
      beforeAgent.id,
    ).length;
    await baseline.shutdown();
    const previewOutput = new CaptureWritable();
    const previewErrors = new CaptureWritable();

    const previewCode = await runCli(
      ["setup", "--workspace", workspace, "--data-root", dataRoot, "--jsonl"],
      cliIo(root, env, previewOutput, previewErrors),
    );

    expect(previewCode).toBe(0);
    expect(previewErrors.text()).toBe("");
    const preview = JSON.parse(previewOutput.text()) as {
      contentSha256: string;
      recommendedProviderId: string;
      candidates: Array<{ environmentVariable: string; status: string }>;
    };
    expect(preview.recommendedProviderId).toBe("deepseek");
    expect(preview.candidates[0]).toEqual(
      expect.objectContaining({
        environmentVariable: "DEEPSEEK_API_KEY",
        status: "available",
      }),
    );
    expect(previewOutput.text()).not.toContain(SECRET);

    const applyOutput = new CaptureWritable();
    const applyErrors = new CaptureWritable();
    const applyCode = await runCli(
      [
        "setup",
        "--workspace",
        workspace,
        "--data-root",
        dataRoot,
        "--provider",
        "deepseek",
        "--expected-preview",
        preview.contentSha256,
        "--apply",
        "--jsonl",
      ],
      cliIo(root, env, applyOutput, applyErrors),
    );

    expect(applyCode).toBe(0);
    expect(applyErrors.text()).toBe("");
    expect(JSON.parse(applyOutput.text())).toEqual(
      expect.objectContaining({
        kind: "napier.provider-setup-result",
        providerId: "deepseek",
        action: "created",
        status: "ready",
      }),
    );
    expect(applyOutput.text()).not.toContain(SECRET);

    const inspection = await createLocalAgentRuntime({
      workspaceRoot: workspace,
      dataRoot,
      env,
    });
    try {
      expect(inspection.store.listThreads()).toEqual(beforeThreads);
      expect(inspection.store.getAgent(beforeAgent.id)).toEqual(beforeAgent);
      expect(inspection.store.listAgentRevisions(beforeAgent.id)).toHaveLength(
        beforeRevisionCount,
      );
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
    } finally {
      await inspection.shutdown();
    }
  });

  it("previews a pinned Browser runtime without installing or creating state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-browser-setup-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();
    let installerCalls = 0;
    const inspection = await installableInspection();

    const code = await runCli(
      ["setup", "--workspace", workspace, "--component", "browser", "--jsonl"],
      cliIo(root, { PRIVATE_SETUP_KEY: SECRET }, stdout, stderr),
      {
        createRuntime: async () => {
          throw new Error("Browser setup must remain Store-free");
        },
        browserSetup: {
          inspect: async () => inspection,
          runInstaller: async () => {
            installerCalls += 1;
            throw new Error("preview must not install");
          },
        },
      },
    );

    expect(code).toBe(0);
    expect(stderr.text()).toBe("");
    expect(installerCalls).toBe(0);
    expect(JSON.parse(stdout.text())).toEqual(
      expect.objectContaining({
        kind: "napier.browser-runtime-setup-preview",
        schemaVersion: 1,
        component: "browser",
        status: "installable",
        packageName: "playwright-core",
        packageVersion: "1.62.1",
        browserName: "chromium",
        browserRevision: "1234",
        browserVersion: "151.0.7922.34",
        runtimeLocationSha256: inspection.target.runtimeLocationSha256,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(stdout.text()).not.toContain(workspace);
    expect(stdout.text()).not.toContain("PRIVATE_SETUP_KEY");
    expect(stdout.text()).not.toContain(SECRET);
    await expect(access(path.join(workspace, ".napier"))).rejects.toThrow();
  });

  it("applies only the exact Browser preview and verifies the installed runtime", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-browser-setup-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const inspection = await installableInspection();
    const previewOutput = new CaptureWritable();
    const createRuntime = async () => {
      throw new Error("Browser setup must remain Store-free");
    };
    await expect(
      runCli(
        [
          "setup",
          "--workspace",
          workspace,
          "--component",
          "browser",
          "--jsonl",
        ],
        cliIo(root, {}, previewOutput, new CaptureWritable()),
        {
          createRuntime,
          browserSetup: { inspect: async () => inspection },
        },
      ),
    ).resolves.toBe(0);
    const preview = JSON.parse(previewOutput.text()) as {
      contentSha256: string;
    };
    const executableSha256 = "c".repeat(64);
    const runtime: BrowserRuntimeBinding = {
      executablePath: path.join(root, "chrome"),
      executableSha256,
    };
    let inspectCount = 0;
    let installerCalls = 0;
    let verifiedRuntime: BrowserRuntimeBinding | undefined;
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();

    const code = await runCli(
      [
        "setup",
        "--workspace",
        workspace,
        "--component",
        "browser",
        "--expected-preview",
        preview.contentSha256,
        "--apply",
        "--jsonl",
      ],
      cliIo(root, { PRIVATE_SETUP_KEY: SECRET }, stdout, stderr),
      {
        createRuntime,
        browserSetup: {
          inspect: async () => {
            inspectCount += 1;
            return inspectCount <= 2
              ? inspection
              : { ...inspection, status: "ready", runtime };
          },
          runInstaller: async (request) => {
            installerCalls += 1;
            expect(request.env).not.toHaveProperty("PRIVATE_SETUP_KEY");
            expect(request.env).not.toHaveProperty("DEEPSEEK_API_KEY");
            expect(request.args).toEqual([
              expect.stringMatching(/browser-runtime-installer-child\.js$/u),
            ]);
            return {
              exitCode: 0,
              outputBytes: 0,
              outputSha256: "d".repeat(64),
            };
          },
          verify: async (_workspaceRoot, candidate) => {
            verifiedRuntime = candidate;
            return {
              executableSha256,
              destinationCount: 1,
              chromiumSandbox: true,
            };
          },
          markVerified: async () => undefined,
        },
      },
    );

    expect(code).toBe(0);
    expect(stderr.text()).toBe("");
    expect(installerCalls).toBe(1);
    expect(verifiedRuntime).toEqual(runtime);
    expect(JSON.parse(stdout.text())).toEqual(
      expect.objectContaining({
        kind: "napier.browser-runtime-setup-result",
        schemaVersion: 1,
        component: "browser",
        action: "installed",
        status: "ready",
        executableSha256,
        destinationCount: 1,
        chromiumSandbox: true,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(stdout.text()).not.toContain(workspace);
    expect(stdout.text()).not.toContain(SECRET);
  });

  it("rejects stale Browser previews without exposing installer or workspace data", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-browser-setup-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const stderr = new CaptureWritable();
    let installerCalls = 0;
    const inspection = await installableInspection();

    const code = await runCli(
      [
        "setup",
        "--workspace",
        workspace,
        "--component",
        "browser",
        "--expected-preview",
        "f".repeat(64),
        "--apply",
      ],
      cliIo(root, { PRIVATE_SETUP_KEY: SECRET }, new CaptureWritable(), stderr),
      {
        createRuntime: async () => {
          throw new Error("Browser setup must remain Store-free");
        },
        browserSetup: {
          inspect: async () => inspection,
          runInstaller: async () => {
            installerCalls += 1;
            throw new Error(`download failed ${SECRET} ${workspace}`);
          },
        },
      },
    );

    expect(code).toBe(1);
    expect(installerCalls).toBe(0);
    expect(stderr.text()).toMatch(
      /^Napier Browser setup failed \([a-f0-9]{16}\)\n$/u,
    );
    expect(stderr.text()).not.toContain(workspace);
    expect(stderr.text()).not.toContain(SECRET);
  });

  it("reuses a ready Browser runtime and never invokes the installer", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-browser-setup-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const current = await inspectPinnedBrowserRuntime();
    expect(current.status).toBe("ready");
    const previewOutput = new CaptureWritable();
    const createRuntime = async () => {
      throw new Error("Browser setup must remain Store-free");
    };
    let installerCalls = 0;
    const browserSetup = {
      inspect: async () => current,
      runInstaller: async () => {
        installerCalls += 1;
        throw new Error("ready runtime must not reinstall");
      },
      verify: async () => ({
        executableSha256: current.runtime!.executableSha256,
        destinationCount: 1,
        chromiumSandbox: true as const,
      }),
      markVerified: async () => undefined,
    };
    await expect(
      runCli(
        [
          "setup",
          "--workspace",
          workspace,
          "--component",
          "browser",
          "--jsonl",
        ],
        cliIo(root, {}, previewOutput, new CaptureWritable()),
        { createRuntime, browserSetup },
      ),
    ).resolves.toBe(0);
    const preview = JSON.parse(previewOutput.text()) as {
      contentSha256: string;
    };
    const resultOutput = new CaptureWritable();

    await expect(
      runCli(
        [
          "setup",
          "--workspace",
          workspace,
          "--component",
          "browser",
          "--expected-preview",
          preview.contentSha256,
          "--apply",
          "--jsonl",
        ],
        cliIo(root, {}, resultOutput, new CaptureWritable()),
        { createRuntime, browserSetup },
      ),
    ).resolves.toBe(0);

    expect(installerCalls).toBe(0);
    expect(JSON.parse(resultOutput.text())).toEqual(
      expect.objectContaining({
        kind: "napier.browser-runtime-setup-result",
        action: "reused",
        status: "ready",
        executableSha256: current.runtime!.executableSha256,
      }),
    );
  });

  it("hashes failed installer diagnostics without exposing output or secrets", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-browser-setup-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const inspection = await installableInspection();
    const previewOutput = new CaptureWritable();
    const createRuntime = async () => {
      throw new Error("Browser setup must remain Store-free");
    };
    await expect(
      runCli(
        [
          "setup",
          "--workspace",
          workspace,
          "--component",
          "browser",
          "--jsonl",
        ],
        cliIo(root, {}, previewOutput, new CaptureWritable()),
        {
          createRuntime,
          browserSetup: { inspect: async () => inspection },
        },
      ),
    ).resolves.toBe(0);
    const preview = JSON.parse(previewOutput.text()) as {
      contentSha256: string;
    };
    const stderr = new CaptureWritable();

    const code = await runCli(
      [
        "setup",
        "--workspace",
        workspace,
        "--component",
        "browser",
        "--expected-preview",
        preview.contentSha256,
        "--apply",
      ],
      cliIo(root, { PRIVATE_SETUP_KEY: SECRET }, new CaptureWritable(), stderr),
      {
        createRuntime,
        browserSetup: {
          inspect: async () => inspection,
          runInstaller: async () => {
            throw new Error(`download failed ${SECRET} ${workspace}`);
          },
        },
      },
    );

    expect(code).toBe(1);
    expect(stderr.text()).toMatch(
      /^Napier Browser setup failed \([a-f0-9]{16}\)\n$/u,
    );
    expect(stderr.text()).not.toContain(workspace);
    expect(stderr.text()).not.toContain(SECRET);
    expect(stderr.text()).not.toContain("download failed");
  });
});

async function installableInspection(): Promise<PinnedBrowserRuntimeInspection> {
  const current = await inspectPinnedBrowserRuntime();
  return {
    target: current.target,
    status: "installable",
  };
}

function cliIo(
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
  stdout: Writable,
  stderr: Writable,
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
