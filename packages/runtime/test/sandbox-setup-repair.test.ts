import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import type { SandboxSetupChecks } from "@napier/contracts/sandbox-setup";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContainerImageIdentity } from "../src/sandbox-container-runtime.js";
import { loadSandboxInstallation } from "../src/sandbox-installation.js";
import type { SandboxRuntimeInspection } from "../src/sandbox-runtime-setup.js";
import { SandboxToolchainDriftError } from "../src/sandbox-runtime-setup.js";
import { SandboxSetupService } from "../src/sandbox-setup-service.js";
import { SwitchableSandboxAdapter } from "../src/sandbox-switchable.js";
import type {
  OsSandboxAdapter,
  SandboxedProcess,
  SandboxLaunchRequest,
} from "../src/sandbox-types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox setup repair", () => {
  it("rebuilds one verification-failing ready image before persisting", async () => {
    const fixture = await createFixture();
    const original = identity("a", "b");
    const repaired = identity("c", "d");
    const fallback = new TestSandbox("macos-sandbox-exec");
    const activated = new TestSandbox("oci-container", repaired.identitySha256);
    const switchable = new SwitchableSandboxAdapter(fallback);
    const inspect = vi.fn(async () => readyInspection(original));
    const buildRuntime = vi.fn(async (input: { force?: boolean }) => {
      expect(input.force).toBe(true);
      return readyInspection(repaired);
    });
    const verifyToolchain = vi
      .fn()
      .mockRejectedValueOnce(new SandboxToolchainDriftError())
      .mockResolvedValueOnce(undefined);
    const verify = vi.fn(async () => ({ checks: readyChecks() }));
    const setup = new SandboxSetupService(
      fixture.workspace,
      fixture.dataRoot,
      switchable,
      {
        inspect,
        buildRuntime,
        verifyToolchain,
        verify,
        activate: async () => activated,
      },
    );
    const preview = await setup.preview();

    const result = await setup.apply(
      { expectedPreviewSha256: preview.contentSha256 },
      new AbortController().signal,
    );

    expect(result).toEqual(
      expect.objectContaining({
        action: "repaired",
        imageId: repaired.imageId,
        identitySha256: repaired.identitySha256,
      }),
    );
    expect(buildRuntime).toHaveBeenCalledTimes(1);
    expect(
      verifyToolchain.mock.calls.map(([imageIdentity]) => imageIdentity.imageId),
    ).toEqual([
      original.imageId,
      repaired.imageId,
    ]);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(switchable.current()).toBe(activated);
    expect(await loadSandboxInstallation(fixture.dataRoot)).toEqual(
      expect.objectContaining({
        imageId: repaired.imageId,
        identitySha256: repaired.identitySha256,
      }),
    );
  });

  it("does not rebuild or persist after verification cancellation", async () => {
    const fixture = await createFixture();
    const fallback = new TestSandbox("macos-sandbox-exec");
    const switchable = new SwitchableSandboxAdapter(fallback);
    const controller = new AbortController();
    const buildRuntime = vi.fn();
    const setup = new SandboxSetupService(
      fixture.workspace,
      fixture.dataRoot,
      switchable,
      {
        inspect: async () => readyInspection(identity("a", "b")),
        buildRuntime,
        verifyToolchain: async () => {
          controller.abort();
          throw new Error("toolchain verification cancelled");
        },
      },
    );
    const preview = await setup.preview();

    await expect(
      setup.apply(
        { expectedPreviewSha256: preview.contentSha256 },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(buildRuntime).not.toHaveBeenCalled();
    expect(switchable.current()).toBe(fallback);
    await expect(
      access(path.join(fixture.dataRoot, "sandbox.json")),
    ).rejects.toThrow();
  });

  it("leaves no binding when the repaired image also fails toolchain identity", async () => {
    const fixture = await createFixture();
    const fallback = new TestSandbox("macos-sandbox-exec");
    const switchable = new SwitchableSandboxAdapter(fallback);
    const verifyToolchain = vi.fn(async () => {
      throw new SandboxToolchainDriftError();
    });
    const setup = new SandboxSetupService(
      fixture.workspace,
      fixture.dataRoot,
      switchable,
      {
        inspect: async () => readyInspection(identity("a", "b")),
        buildRuntime: async () => readyInspection(identity("c", "d")),
        verifyToolchain,
        verify: async () => ({ checks: readyChecks() }),
      },
    );
    const preview = await setup.preview();

    await expect(
      setup.apply(
        { expectedPreviewSha256: preview.contentSha256 },
        new AbortController().signal,
      ),
    ).rejects.toThrow("toolchain identity is invalid");
    expect(verifyToolchain).toHaveBeenCalledTimes(2);
    expect(switchable.current()).toBe(fallback);
    await expect(
      access(path.join(fixture.dataRoot, "sandbox.json")),
    ).rejects.toThrow();
  });

  it("does not rebuild when the toolchain identity probe cannot execute", async () => {
    const fixture = await createFixture();
    const fallback = new TestSandbox("macos-sandbox-exec");
    const switchable = new SwitchableSandboxAdapter(fallback);
    const buildRuntime = vi.fn();
    const setup = new SandboxSetupService(
      fixture.workspace,
      fixture.dataRoot,
      switchable,
      {
        inspect: async () => readyInspection(identity("a", "b")),
        buildRuntime,
        verifyToolchain: async () => {
          throw new Error("OCI container identity probe failed");
        },
        verify: async () => ({ checks: readyChecks() }),
      },
    );
    const preview = await setup.preview();

    await expect(
      setup.apply(
        { expectedPreviewSha256: preview.contentSha256 },
        new AbortController().signal,
      ),
    ).rejects.toThrow("identity probe failed");
    expect(buildRuntime).not.toHaveBeenCalled();
    expect(switchable.current()).toBe(fallback);
  });

  it("does not rebuild for workspace or resource verification failures", async () => {
    const fixture = await createFixture();
    const fallback = new TestSandbox("macos-sandbox-exec");
    const switchable = new SwitchableSandboxAdapter(fallback);
    const buildRuntime = vi.fn();
    const setup = new SandboxSetupService(
      fixture.workspace,
      fixture.dataRoot,
      switchable,
      {
        inspect: async () => readyInspection(identity("a", "b")),
        buildRuntime,
        verifyToolchain: async () => undefined,
        verify: async () => {
          throw new Error("Official Sandbox resources verification failed");
        },
      },
    );
    const preview = await setup.preview();

    await expect(
      setup.apply(
        { expectedPreviewSha256: preview.contentSha256 },
        new AbortController().signal,
      ),
    ).rejects.toThrow("resources verification failed");
    expect(buildRuntime).not.toHaveBeenCalled();
    expect(switchable.current()).toBe(fallback);
  });
});

function readyInspection(
  imageIdentity: ContainerImageIdentity,
): SandboxRuntimeInspection & {
  status: "ready";
  identity: ContainerImageIdentity;
} {
  return {
    status: "ready",
    identity: imageIdentity,
    target: {
      imageReference: "napier-sandbox:0.1.0",
      acquisition: "packaged_source",
      dockerfileSha256: "1".repeat(64),
      contextSha256: "2".repeat(64),
      platform: process.platform,
      arch: process.arch,
    },
  };
}

function identity(imageSeed: string, identitySeed: string): ContainerImageIdentity {
  return {
    imageId: `sha256:${imageSeed.repeat(64)}`,
    imagePlatform: "linux/arm64",
    clientExecutable: process.execPath,
    clientExecutableSha256: "3".repeat(64),
    daemon: { location: "local", endpointSha256: "4".repeat(64) },
    user: {
      userId: 501,
      groupId: 20,
      mapping: "host-posix",
      identitySha256: "5".repeat(64),
    },
    identitySha256: identitySeed.repeat(64),
  };
}

function readyChecks(): SandboxSetupChecks {
  return {
    node: "sandbox_process_ready",
    resources: "sandbox_resources_ready",
    verification: "verification_ready",
    shell: "shell_ready",
    python: "python_ready",
    git: "git_ready",
    lsp: "lsp_ready",
    dap: "dap_ready",
    service: "service_ready",
  };
}

async function createFixture(): Promise<{
  workspace: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-repair-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  const dataRoot = path.join(root, "state");
  await Promise.all([mkdir(workspace), mkdir(dataRoot)]);
  return { workspace, dataRoot };
}

class TestSandbox implements OsSandboxAdapter {
  constructor(
    readonly id: string,
    readonly setupIdentitySha256?: string,
  ) {}

  async launch(_request: SandboxLaunchRequest): Promise<SandboxedProcess> {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stdin.end();
    stdout.end();
    stderr.end();
    return {
      stdin,
      stdout,
      stderr,
      exit: Promise.resolve({ code: 0, signal: null }),
      terminate: async () => undefined,
    };
  }
}
