import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";

const roots: string[] = [];
const SECRET = "provider-setup-secret-never-render";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Provider setup", () => {
  it("previews without mutation and applies only the exact selected preview", async () => {
    const services = await createFixture({ DEEPSEEK_API_KEY: SECRET });
    try {
      const agent = services.store.listAgents()[0]!;
      const beforeRevisionCount =
        services.store.listAgentRevisions(agent.id).length;
      const beforeThreads = services.store.listThreads();

      const preview = await services.providerSetup.preview();

      expect(preview).toEqual(
        expect.objectContaining({
          kind: "napier.provider-setup-preview",
          candidateCount: 5,
          readyCount: 0,
          availableCount: 1,
          recommendedProviderId: "deepseek",
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      );
      expect(
        preview.candidates.find(
          (candidate) => candidate.providerId === "deepseek",
        ),
      ).toEqual(
        expect.objectContaining({
          environmentVariable: "DEEPSEEK_API_KEY",
          model: { provider: "deepseek", id: "deepseek-v4-flash" },
          status: "available",
        }),
      );
      expect(JSON.stringify(preview)).not.toContain(SECRET);
      expect(services.store.listCredentialReferences()).toEqual([]);
      expect(services.store.listThreads()).toEqual(beforeThreads);
      expect(services.store.listAgentRevisions(agent.id)).toHaveLength(
        beforeRevisionCount,
      );

      await expect(
        services.providerSetup.apply({
          providerId: "deepseek",
          expectedPreviewSha256: "0".repeat(64),
        }),
      ).rejects.toThrow("Provider setup preview changed");
      expect(services.store.listCredentialReferences()).toEqual([]);

      const result = await services.providerSetup.apply({
        providerId: "deepseek",
        expectedPreviewSha256: preview.contentSha256,
      });

      expect(result).toEqual(
        expect.objectContaining({
          kind: "napier.provider-setup-result",
          providerId: "deepseek",
          model: { provider: "deepseek", id: "deepseek-v4-flash" },
          status: "ready",
          action: "created",
          previewSha256: preview.contentSha256,
          referenceIdSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      );
      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(services.store.listCredentialReferences()).toEqual([
        expect.objectContaining({
          providerId: "deepseek",
          status: "active",
          availability: "available",
          source: {
            type: "environment",
            variable: "DEEPSEEK_API_KEY",
          },
        }),
      ]);
      expect(services.store.listThreads()).toEqual(beforeThreads);
      expect(services.store.getAgent(agent.id)).toEqual(agent);
      expect(services.store.listAgentRevisions(agent.id)).toHaveLength(
        beforeRevisionCount,
      );
      expect(
        (await services.providerSetup.preview()).candidates.find(
          (candidate) => candidate.providerId === "deepseek",
        )?.status,
      ).toBe("ready");
    } finally {
      await services.shutdown();
    }
  });

  it("disables a newly created locator when availability verification fails", async () => {
    const services = await createFixture({ DEEPSEEK_API_KEY: SECRET });
    try {
      const beforeThreads = services.store.listThreads();
      const preview = await services.providerSetup.preview();
      vi.spyOn(services.credentials, "check").mockImplementation(
        async (referenceId) => ({
          ...services.store.getCredentialReference(referenceId),
          availability: "missing",
        }),
      );

      await expect(
        services.providerSetup.apply({
          providerId: "deepseek",
          expectedPreviewSha256: preview.contentSha256,
        }),
      ).rejects.toThrow("Provider setup credential is unavailable");

      expect(services.store.listCredentialReferences()).toEqual([
        expect.objectContaining({
          providerId: "deepseek",
          status: "disabled",
        }),
      ]);
      expect(services.store.listThreads()).toEqual(beforeThreads);
    } finally {
      await services.shutdown();
    }
  });

  it("refuses to replace another active locator for the same Provider", async () => {
    const services = await createFixture({
      DEEPSEEK_API_KEY: SECRET,
      TEAM_DEEPSEEK_KEY: "separate-secret",
    });
    try {
      await services.store.createCredentialReference({
        providerId: "deepseek",
        label: "Team locator",
        source: { type: "environment", variable: "TEAM_DEEPSEEK_KEY" },
      });

      const preview = await services.providerSetup.preview();
      expect(
        preview.candidates.find(
          (candidate) => candidate.providerId === "deepseek",
        )?.status,
      ).toBe("conflict");
      await expect(
        services.providerSetup.apply({
          providerId: "deepseek",
          expectedPreviewSha256: preview.contentSha256,
        }),
      ).rejects.toThrow("Provider setup candidate is conflict");
      expect(services.store.listCredentialReferences()).toHaveLength(1);
    } finally {
      await services.shutdown();
    }
  });

  it("recommends an existing ready Provider before a new available locator", async () => {
    const services = await createFixture({
      DEEPSEEK_API_KEY: SECRET,
      OPENAI_API_KEY: "ready-openai-secret",
    });
    try {
      const reference = await services.store.createCredentialReference({
        providerId: "openai",
        label: "OpenAI key",
        source: { type: "environment", variable: "OPENAI_API_KEY" },
      });
      await services.credentials.check(reference.id);

      const preview = await services.providerSetup.preview();

      expect(preview.recommendedProviderId).toBe("openai");
      expect(
        preview.candidates.find(
          (candidate) => candidate.providerId === "deepseek",
        )?.status,
      ).toBe("available");
      expect(
        preview.candidates.find(
          (candidate) => candidate.providerId === "openai",
        )?.status,
      ).toBe("ready");
    } finally {
      await services.shutdown();
    }
  });
});

async function createFixture(
  env: Readonly<Record<string, string | undefined>>,
) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-provider-setup-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  return createLocalAgentRuntime({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
    env,
  });
}
