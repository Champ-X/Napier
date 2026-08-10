import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type {
  OsSandboxAdapter,
  SandboxedProcess,
  SandboxLaunchRequest,
} from "../src/sandbox-types.js";
import type { SandboxInstallation } from "../src/sandbox-installation.js";
import { SandboxSetupService } from "../src/sandbox-setup-service.js";
import { SwitchableSandboxAdapter } from "../src/sandbox-switchable.js";

describe("Sandbox uninstall service", () => {
  it("previews and removes only the exact binding before hot fallback", async () => {
    const active = new TestSandbox("oci-container", "e".repeat(64));
    const fallback = new TestSandbox("macos-sandbox-exec");
    const switchable = new SwitchableSandboxAdapter(active);
    const installation = record();
    const removeInstallation = vi.fn(async () => undefined);
    const setup = new SandboxSetupService(
      "/workspace",
      "/state",
      switchable,
      {
        inspect: vi.fn(),
        loadInstallation: async () => installation,
        removeInstallation,
        fallback: () => fallback,
      },
    );

    const preview = await setup.uninstallPreview();
    expect(preview).toEqual(
      expect.objectContaining({
        status: "installed",
        active: true,
        imageRetained: true,
        installationSha256: installation.contentSha256,
        fallbackSandbox: fallback.id,
      }),
    );

    const result = await setup.uninstall({
      expectedPreviewSha256: preview.contentSha256,
    });

    expect(removeInstallation).toHaveBeenCalledWith(
      "/state",
      installation.contentSha256,
    );
    expect(switchable.current()).toBe(fallback);
    expect(result).toEqual(
      expect.objectContaining({
        action: "uninstalled",
        status: "removed",
        imageRetained: true,
        imageId: installation.imageId,
        fallbackSandbox: fallback.id,
      }),
    );
  });

  it("rejects stale or absent bindings without switching adapters", async () => {
    const active = new TestSandbox("oci-container", "e".repeat(64));
    const switchable = new SwitchableSandboxAdapter(active);
    const removeInstallation = vi.fn(async () => undefined);
    const setup = new SandboxSetupService(
      "/workspace",
      "/state",
      switchable,
      {
        inspect: vi.fn(),
        loadInstallation: async () => undefined,
        removeInstallation,
        fallback: () => new TestSandbox("unsupported"),
      },
    );
    const preview = await setup.uninstallPreview();
    expect(preview.status).toBe("not_installed");

    await expect(
      setup.uninstall({ expectedPreviewSha256: "0".repeat(64) }),
    ).rejects.toThrow("preview is stale");
    await expect(
      setup.uninstall({ expectedPreviewSha256: preview.contentSha256 }),
    ).rejects.toThrow("not configured");
    expect(removeInstallation).not.toHaveBeenCalled();
    expect(switchable.current()).toBe(active);
  });

  it("keeps the active adapter when persisted removal fails", async () => {
    const active = new TestSandbox("oci-container", "e".repeat(64));
    const switchable = new SwitchableSandboxAdapter(active);
    const setup = new SandboxSetupService(
      "/workspace",
      "/state",
      switchable,
      {
        inspect: vi.fn(),
        loadInstallation: async () => record(),
        removeInstallation: async () => {
          throw new Error("synthetic removal failure");
        },
        fallback: () => new TestSandbox("macos-sandbox-exec"),
      },
    );
    const preview = await setup.uninstallPreview();

    await expect(
      setup.uninstall({ expectedPreviewSha256: preview.contentSha256 }),
    ).rejects.toThrow("synthetic removal failure");
    expect(switchable.current()).toBe(active);
  });
});

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

function record(): SandboxInstallation {
  return {
    kind: "napier.sandbox-installation",
    schemaVersion: 1,
    provider: "oci-container",
    imageReference: "napier-sandbox:0.1.0",
    imageId: `sha256:${"a".repeat(64)}`,
    clientExecutableSha256: "b".repeat(64),
    daemonEndpointSha256: "c".repeat(64),
    userIdentitySha256: "d".repeat(64),
    identitySha256: "e".repeat(64),
    verifiedAt: "2026-08-11T00:00:00.000Z",
    contentSha256: "f".repeat(64),
  };
}
