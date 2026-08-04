import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ProviderSetupPreview,
  ProviderSetupResult,
} from "@napier/contracts/provider-setup";

import {
  applyProviderSetup,
  getProviderSetupPreview,
} from "../src/provider-setup-api";
import { canonicalJson, sha256Text } from "../src/stable-digest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Provider setup Web API", () => {
  it("verifies preview evidence and sends only Provider identity plus exact hash", async () => {
    const preview = await providerPreview();
    const result = await providerResult(preview);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(stableResponse(preview))
      .mockResolvedValueOnce(stableResponse(result));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getProviderSetupPreview()).resolves.toEqual(preview);
    await expect(
      applyProviderSetup({
        providerId: "deepseek",
        expectedPreviewSha256: preview.contentSha256,
      }),
    ).resolves.toEqual(result);

    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/setup/providers",
      {
        headers: { "Content-Type": "application/json" },
      },
    ]);
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/setup/providers",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          providerId: "deepseek",
          expectedPreviewSha256: preview.contentSha256,
        }),
      }),
    ]);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("secret");
  });

  it("rejects a tampered preview before it can authorize setup", async () => {
    const preview = await providerPreview();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        stableResponse({
          ...preview,
          availableCount: 0,
        } as ProviderSetupPreview),
      ),
    );

    await expect(getProviderSetupPreview()).rejects.toThrow("hash mismatch");
  });
});

async function providerPreview(): Promise<ProviderSetupPreview> {
  const content = {
    kind: "napier.provider-setup-preview" as const,
    schemaVersion: 1 as const,
    candidates: [
      {
        providerId: "deepseek",
        providerName: "DeepSeek",
        environmentVariable: "DEEPSEEK_API_KEY",
        model: { provider: "deepseek", id: "deepseek-v4-flash" },
        status: "available" as const,
      },
    ],
    recommendedProviderId: "deepseek",
    candidateCount: 1,
    readyCount: 0,
    availableCount: 1,
    candidateSetSha256: "a".repeat(64),
  };
  return {
    ...content,
    contentSha256: await sha256Text(canonicalJson(content)),
  };
}

async function providerResult(
  preview: ProviderSetupPreview,
): Promise<ProviderSetupResult> {
  const content = {
    kind: "napier.provider-setup-result" as const,
    schemaVersion: 1 as const,
    providerId: "deepseek",
    model: { provider: "deepseek", id: "deepseek-v4-flash" },
    status: "ready" as const,
    action: "created" as const,
    referenceIdSha256: "b".repeat(64),
    previewSha256: preview.contentSha256,
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
