import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContainerImageIdentity } from "@napier/runtime/sandbox-container-runtime";
import type { SandboxRuntimeInspection } from "@napier/runtime/sandbox-runtime-setup";
import { UnsupportedSandboxAdapter } from "@napier/runtime";

import { parseCliArgs, runCli } from "../src/cli.js";
import type { CliIo } from "../src/cli-runtime.js";

const roots: string[] = [];
const SECRET = "sandbox-secret-never-print";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier Sandbox setup CLI", () => {
  it("parses Sandbox preview and persistent data-root options", () => {
    expect(
      parseCliArgs([
        "setup",
        "--workspace",
        ".",
        "--data-root",
        ".napier-custom",
        "--component",
        "sandbox",
        "--timeout-ms",
        "600000",
        "--jsonl",
      ]),
    ).toEqual({
      kind: "setup",
      options: {
        workspace: ".",
        dataRoot: ".napier-custom",
        component: "sandbox",
        timeoutMs: 600_000,
        apply: false,
        jsonl: true,
      },
    });
  });

  it("previews without building or creating persistent state", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();
    let buildCalls = 0;

    const code = await runCli(
      [
        "setup",
        "--workspace",
        fixture.workspace,
        "--component",
        "sandbox",
        "--jsonl",
      ],
      cliIo(fixture.root, { PRIVATE_SETUP_KEY: SECRET }, stdout),
      {
        createRuntime: vi.fn(),
        sandboxSetup: {
          inspect: async () => inspection("buildable"),
          runBuild: async () => {
            buildCalls += 1;
            throw new Error("preview must not build");
          },
        },
      },
    );

    expect(code).toBe(0);
    expect(buildCalls).toBe(0);
    expect(JSON.parse(stdout.text())).toEqual(
      expect.objectContaining({
        kind: "napier.sandbox-runtime-setup-preview",
        component: "sandbox",
        status: "buildable",
        imageReference: "napier-sandbox:0.1.0",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(stdout.text()).not.toContain(fixture.workspace);
    expect(stdout.text()).not.toContain(SECRET);
    await expect(
      access(path.join(fixture.workspace, ".napier", "sandbox.json")),
    ).rejects.toThrow();
  });

  it("rejects a stale preview before build", async () => {
    const fixture = await createFixture();
    let buildCalls = 0;
    const stderr = new CaptureWritable();

    const code = await runCli(
      [
        "setup",
        "--workspace",
        fixture.workspace,
        "--component",
        "sandbox",
        "--expected-preview",
        "f".repeat(64),
        "--apply",
      ],
      cliIo(fixture.root, { PRIVATE_SETUP_KEY: SECRET }, undefined, stderr),
      {
        createRuntime: vi.fn(),
        sandboxSetup: {
          inspect: async () => inspection("buildable"),
          runBuild: async () => {
            buildCalls += 1;
            throw new Error("stale preview must not build");
          },
        },
      },
    );

    expect(code).toBe(1);
    expect(buildCalls).toBe(0);
    expect(stderr.text()).toMatch(
      /^Napier Sandbox setup failed \([a-f0-9]{16}\)\n$/u,
    );
    expect(stderr.text()).not.toContain(SECRET);
  });

  it("persists only after all production checks succeed", async () => {
    const fixture = await createFixture();
    const preview = await previewFor(fixture);
    const stdout = new CaptureWritable();
    const verify = vi.fn(async () => ({
      checks: {
        node: "sandbox_process_ready",
        shell: "shell_ready",
        python: "python_ready",
        git: "git_ready",
        lsp: "lsp_ready",
        dap: "dap_ready",
        service: "service_ready",
      },
    }));

    const code = await runCli(
      [
        "setup",
        "--workspace",
        fixture.workspace,
        "--component",
        "sandbox",
        "--expected-preview",
        preview,
        "--apply",
        "--jsonl",
      ],
      cliIo(fixture.root, {}, stdout),
      {
        createRuntime: vi.fn(),
        sandboxSetup: {
          inspect: async () => inspection("ready", identity()),
          verify,
          activate: async () =>
            new UnsupportedSandboxAdapter("sandbox-setup-activated"),
        },
      },
    );

    expect(code).toBe(0);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stdout.text())).toEqual(
      expect.objectContaining({
        kind: "napier.sandbox-runtime-setup-result",
        action: "reused",
        status: "ready",
        imageId: identity().imageId,
      }),
    );
    await expect(
      access(path.join(fixture.workspace, ".napier", "sandbox.json")),
    ).resolves.toBeUndefined();
  });

  it("leaves no installation when production verification fails", async () => {
    const fixture = await createFixture();
    const preview = await previewFor(fixture);

    const code = await runCli(
      [
        "setup",
        "--workspace",
        fixture.workspace,
        "--component",
        "sandbox",
        "--expected-preview",
        preview,
        "--apply",
      ],
      cliIo(fixture.root, { PRIVATE_SETUP_KEY: SECRET }),
      {
        createRuntime: vi.fn(),
        sandboxSetup: {
          inspect: async () => inspection("ready", identity()),
          verify: async () => {
            throw new Error(`shell probe failed ${SECRET}`);
          },
        },
      },
    );

    expect(code).toBe(1);
    await expect(
      access(path.join(fixture.workspace, ".napier")),
    ).rejects.toThrow();
  });
});

async function previewFor(fixture: {
  root: string;
  workspace: string;
}): Promise<string> {
  const output = new CaptureWritable();
  await runCli(
    [
      "setup",
      "--workspace",
      fixture.workspace,
      "--component",
      "sandbox",
      "--jsonl",
    ],
    cliIo(fixture.root, {}, output),
    {
      createRuntime: vi.fn(),
      sandboxSetup: {
        inspect: async () => inspection("ready", identity()),
      },
    },
  );
  return (JSON.parse(output.text()) as { contentSha256: string }).contentSha256;
}

function inspection(
  status: SandboxRuntimeInspection["status"],
  imageIdentity?: ContainerImageIdentity,
): SandboxRuntimeInspection {
  return {
    status,
    target: {
      imageReference: "napier-sandbox:0.1.0",
      dockerfileSha256: "1".repeat(64),
      contextSha256: "2".repeat(64),
      platform: process.platform,
      arch: process.arch,
    },
    ...(imageIdentity ? { identity: imageIdentity } : {}),
  };
}

function identity(): ContainerImageIdentity {
  return {
    imageId: `sha256:${"a".repeat(64)}`,
    clientExecutable: process.execPath,
    clientExecutableSha256: "b".repeat(64),
    daemon: { location: "local", endpointSha256: "c".repeat(64) },
    user: {
      userId: 501,
      groupId: 20,
      identitySha256: "d".repeat(64),
    },
    identitySha256: "e".repeat(64),
  };
}

async function createFixture(): Promise<{ root: string; workspace: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-setup-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  return { root, workspace };
}

function cliIo(
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
  stdout = new CaptureWritable(),
  stderr = new CaptureWritable(),
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
