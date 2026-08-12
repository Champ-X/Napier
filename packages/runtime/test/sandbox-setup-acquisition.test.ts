import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import type { SandboxSetupChecks } from "@napier/contracts/sandbox-setup";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContainerImageIdentity } from "../src/sandbox-container-runtime.js";
import {
  loadSandboxInstallation,
  type SandboxInstallation,
} from "../src/sandbox-installation.js";
import type { OfficialSandboxRelease } from "../src/sandbox-official-release.js";
import type { ReadySandboxRuntime } from "../src/sandbox-runtime-acquisition.js";
import type { SandboxRuntimeInspection } from "../src/sandbox-runtime-setup.js";
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

describe("Sandbox setup acquisition", () => {
  it("pulls a reviewed release and persists schema-2 provenance after verification", async () => {
    const fixture = await createFixture();
    const release = externalRelease();
    const pulled = readyInspection(
      identity("a", "b"),
      "external_release",
      release,
    );
    const buildRuntime = vi.fn();
    const discardRelease = vi.fn();
    const setup = setupService(fixture, {
      inspect: async () => pullableInspection(release),
      pullRuntime: async () => pulled,
      buildRuntime,
      discardRelease,
    });
    const preview = await setup.preview();

    const result = await setup.apply(
      { expectedPreviewSha256: preview.contentSha256 },
      new AbortController().signal,
    );

    expect(result).toEqual(
      expect.objectContaining({
        action: "pulled",
        acquisition: "external_release",
        imageReference: release.reference,
        releaseDigest: release.digest,
        releaseSourceSha: release.sourceSha,
        releaseReceiptSha256: release.receiptSha256,
      }),
    );
    expect(buildRuntime).not.toHaveBeenCalled();
    expect(discardRelease).not.toHaveBeenCalled();
    expect(await loadSandboxInstallation(fixture.dataRoot)).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        acquisition: "external_release",
        imageReference: release.reference,
        releaseDigest: release.digest,
        releaseSourceSha: release.sourceSha,
        releaseReceiptSha256: release.receiptSha256,
      }),
    );
  });

  it("falls back to the pinned source only when anonymous pull is unavailable", async () => {
    const fixture = await createFixture();
    const release = externalRelease();
    const built = readyInspection(identity("c", "d"), "packaged_source");
    const pullRuntime = vi.fn(async () => undefined);
    const buildRuntime = vi.fn(async () => built);
    const setup = setupService(fixture, {
      inspect: async () => pullableInspection(release),
      pullRuntime,
      buildRuntime,
    });
    const preview = await setup.preview();

    const result = await setup.apply(
      { expectedPreviewSha256: preview.contentSha256 },
      new AbortController().signal,
    );

    expect(result).toEqual(
      expect.objectContaining({
        action: "built",
        acquisition: "packaged_source",
        imageReference: "napier-sandbox:0.1.0",
      }),
    );
    expect("releaseDigest" in result).toBe(false);
    expect(pullRuntime).toHaveBeenCalledTimes(1);
    expect(buildRuntime).toHaveBeenCalledTimes(1);
    expect(await loadSandboxInstallation(fixture.dataRoot)).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        acquisition: "packaged_source",
        imageReference: "napier-sandbox:0.1.0",
      }),
    );
  });

  it("discards a pulled release when toolchain verification fails", async () => {
    const fixture = await createFixture();
    const release = externalRelease();
    const pulled = readyInspection(
      identity("a", "b"),
      "external_release",
      release,
    );
    const buildRuntime = vi.fn();
    const discardRelease = vi.fn();
    const activate = vi.fn();
    const setup = setupService(fixture, {
      inspect: async () => pullableInspection(release),
      pullRuntime: async () => pulled,
      buildRuntime,
      discardRelease,
      activate,
      verifyToolchain: async () => {
        throw new Error("Official Sandbox release toolchain is invalid");
      },
    });
    const preview = await setup.preview();

    await expect(
      setup.apply(
        { expectedPreviewSha256: preview.contentSha256 },
        new AbortController().signal,
      ),
    ).rejects.toThrow("release toolchain is invalid");
    expect(buildRuntime).not.toHaveBeenCalled();
    expect(discardRelease).toHaveBeenCalledTimes(1);
    expect(discardRelease).toHaveBeenCalledWith(
      release,
      expect.any(AbortSignal),
    );
    expect(activate).not.toHaveBeenCalled();
    await expect(
      access(path.join(fixture.dataRoot, "sandbox.json")),
    ).rejects.toThrow();
  });

  it("does not build or persist after pull cancellation", async () => {
    const fixture = await createFixture();
    const release = externalRelease();
    const controller = new AbortController();
    const buildRuntime = vi.fn();
    const discardRelease = vi.fn();
    const setup = setupService(fixture, {
      inspect: async () => pullableInspection(release),
      pullRuntime: async () => {
        controller.abort();
        controller.signal.throwIfAborted();
      },
      buildRuntime,
      discardRelease,
    });
    const preview = await setup.preview();

    await expect(
      setup.apply(
        { expectedPreviewSha256: preview.contentSha256 },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(buildRuntime).not.toHaveBeenCalled();
    expect(discardRelease).not.toHaveBeenCalled();
    await expect(
      access(path.join(fixture.dataRoot, "sandbox.json")),
    ).rejects.toThrow();
  });
});

function setupService(
  fixture: { workspace: string; dataRoot: string },
  dependencies: ConstructorParameters<typeof SandboxSetupService>[3],
): SandboxSetupService {
  return new SandboxSetupService(
    fixture.workspace,
    fixture.dataRoot,
    new SwitchableSandboxAdapter(new TestSandbox("fallback")),
    {
      verifyToolchain: async () => undefined,
      verify: async () => ({ checks: readyChecks() }),
      activate: async ({ installation }) =>
        new TestSandbox("oci-container", installation.identitySha256),
      ...dependencies,
    },
  );
}

function pullableInspection(
  release: OfficialSandboxRelease,
): SandboxRuntimeInspection {
  return {
    status: "pullable",
    target: target("external_release", release),
  };
}

function readyInspection(
  imageIdentity: ContainerImageIdentity,
  acquisition: "external_release" | "packaged_source",
  release?: OfficialSandboxRelease,
): ReadySandboxRuntime {
  return {
    status: "ready",
    identity: imageIdentity,
    target: target(acquisition, release),
  };
}

function target(
  acquisition: "external_release" | "packaged_source",
  release?: OfficialSandboxRelease,
): SandboxRuntimeInspection["target"] {
  return {
    imageReference:
      acquisition === "external_release"
        ? release!.reference
        : "napier-sandbox:0.1.0",
    acquisition,
    ...(release ? { release } : {}),
    dockerfileSha256: "1".repeat(64),
    contextSha256: "2".repeat(64),
    platform: process.platform,
    arch: process.arch,
  };
}

function externalRelease(): OfficialSandboxRelease {
  const digest = `sha256:${"f".repeat(64)}`;
  return {
    image: "ghcr.io/champ-x/napier-sandbox",
    version: "0.1.0",
    digest,
    reference: `ghcr.io/champ-x/napier-sandbox@${digest}`,
    sourceSha: "e".repeat(40),
    contextSha256: "2".repeat(64),
    receiptSha256: "d".repeat(64),
    platforms: ["linux/amd64", "linux/arm64"],
  };
}

function identity(
  imageSeed: string,
  identitySeed: string,
): ContainerImageIdentity {
  return {
    imageId: `sha256:${imageSeed.repeat(64)}`,
    imagePlatform: process.arch === "x64" ? "linux/amd64" : "linux/arm64",
    clientExecutable: process.execPath,
    clientExecutableSha256: "3".repeat(64),
    daemon: { location: "local", endpointSha256: "4".repeat(64) },
    user: {
      userId: 501,
      groupId: 20,
      mapping: "injected",
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
  const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-acquire-"));
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
