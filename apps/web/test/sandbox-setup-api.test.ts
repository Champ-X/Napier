import type {
  SandboxSetupPreview,
  SandboxSetupResult,
} from "@napier/contracts/sandbox-setup";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applySandboxSetup,
  getSandboxSetupPreview,
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
});

async function sandboxPreview(): Promise<SandboxSetupPreview> {
  const content = {
    kind: "napier.sandbox-runtime-setup-preview" as const,
    schemaVersion: 1 as const,
    component: "sandbox" as const,
    status: "buildable" as const,
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
    status: "ready" as const,
    imageReference: preview.imageReference,
    imageId: `sha256:${"c".repeat(64)}`,
    dockerfileSha256: preview.dockerfileSha256,
    contextSha256: preview.contextSha256,
    identitySha256: "d".repeat(64),
    installationSha256: "e".repeat(64),
    checks: {
      node: "sandbox_process_ready",
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
