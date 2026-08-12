import type {
  SandboxSetupPreview,
  SandboxSetupResult,
  SandboxUninstallPreview,
  SandboxUninstallResult,
} from "@napier/contracts/sandbox-setup";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applySandboxSetup,
  applySandboxUninstall,
  getSandboxSetupPreview,
  getSandboxUninstallPreview,
} from "../src/sandbox-setup-api";
import { canonicalJson, sha256Text } from "../src/stable-digest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Sandbox setup Web API", () => {
  it("verifies evidence and sends only the exact preview hash", async () => {
    const preview = await sandboxPreview();
    const result = await sandboxResult(preview);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(stableResponse(preview))
      .mockResolvedValueOnce(stableResponse(result));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSandboxSetupPreview()).resolves.toEqual(preview);
    await expect(
      applySandboxSetup({
        expectedPreviewSha256: preview.contentSha256,
      }),
    ).resolves.toEqual(result);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/setup/sandbox");
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/setup/sandbox",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedPreviewSha256: preview.contentSha256,
        }),
      }),
    ]);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("imageId");
  });

  it("rejects tampered setup evidence before it can authorize apply", async () => {
    const preview = await sandboxPreview();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        stableResponse({
          ...preview,
          status: "runtime_unavailable",
        } as SandboxSetupPreview),
      ),
    );

    await expect(getSandboxSetupPreview()).rejects.toThrow("hash mismatch");
  });

  it("previews and applies only the exact uninstall hash", async () => {
    const preview = await sandboxUninstallPreview();
    const result = await sandboxUninstallResult(preview);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(stableResponse(preview))
      .mockResolvedValueOnce(stableResponse(result));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSandboxUninstallPreview()).resolves.toEqual(preview);
    await expect(
      applySandboxUninstall({
        expectedPreviewSha256: preview.contentSha256,
      }),
    ).resolves.toEqual(result);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/setup/sandbox/uninstall");
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/setup/sandbox/uninstall",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedPreviewSha256: preview.contentSha256,
        }),
      }),
    ]);
  });
});

async function sandboxPreview(): Promise<SandboxSetupPreview> {
  const content = {
    kind: "napier.sandbox-runtime-setup-preview" as const,
    schemaVersion: 1 as const,
    component: "sandbox" as const,
    status: "buildable" as const,
    acquisition: "packaged_source" as const,
    active: false,
    imageReference: "napier-sandbox:0.1.0",
    dockerfileSha256: "a".repeat(64),
    contextSha256: "b".repeat(64),
    platform: "linux" as const,
    arch: "x64",
  };
  return {
    ...content,
    contentSha256: await sha256Text(canonicalJson(content)),
  };
}

async function sandboxResult(
  preview: SandboxSetupPreview,
): Promise<SandboxSetupResult> {
  const content = {
    kind: "napier.sandbox-runtime-setup-result" as const,
    schemaVersion: 1 as const,
    component: "sandbox" as const,
    action: "built" as const,
    acquisition: preview.acquisition,
    status: "ready" as const,
    imageReference: preview.imageReference,
    imageId: `sha256:${"c".repeat(64)}`,
    dockerfileSha256: preview.dockerfileSha256,
    contextSha256: preview.contextSha256,
    identitySha256: "d".repeat(64),
    installationSha256: "e".repeat(64),
    checks: {
      node: "sandbox_process_ready",
      resources: "sandbox_resources_ready",
      verification: "verification_ready",
      shell: "shell_ready",
      python: "python_ready",
      git: "git_ready",
      lsp: "lsp_ready",
      dap: "dap_ready",
      service: "service_ready",
    },
  };
  return {
    ...content,
    contentSha256: await sha256Text(canonicalJson(content)),
  };
}

async function sandboxUninstallPreview(): Promise<SandboxUninstallPreview> {
  const content = {
    kind: "napier.sandbox-runtime-uninstall-preview" as const,
    schemaVersion: 1 as const,
    component: "sandbox" as const,
    status: "installed" as const,
    active: true,
    imageRetained: true as const,
    bindingSha256: "f".repeat(64),
    imageReference: "napier-sandbox:0.1.0",
    imageId: `sha256:${"c".repeat(64)}`,
    identitySha256: "d".repeat(64),
    installationSha256: "e".repeat(64),
    fallbackSandbox: "macos-sandbox-exec",
  };
  return {
    ...content,
    contentSha256: await sha256Text(canonicalJson(content)),
  };
}

async function sandboxUninstallResult(
  preview: SandboxUninstallPreview,
): Promise<SandboxUninstallResult> {
  const content = {
    kind: "napier.sandbox-runtime-uninstall-result" as const,
    schemaVersion: 1 as const,
    component: "sandbox" as const,
    action: "uninstalled" as const,
    status: "removed" as const,
    imageRetained: true as const,
    bindingSha256: preview.bindingSha256!,
    imageReference: preview.imageReference!,
    imageId: preview.imageId!,
    identitySha256: preview.identitySha256!,
    installationSha256: preview.installationSha256!,
    fallbackSandbox: preview.fallbackSandbox,
  };
  return {
    ...content,
    contentSha256: await sha256Text(canonicalJson(content)),
  };
}

function stableResponse(value: { contentSha256: string }): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Napier-Content-SHA256": value.contentSha256,
      "X-Napier-Content-SHA256-Mode": "stable",
    },
  });
}
