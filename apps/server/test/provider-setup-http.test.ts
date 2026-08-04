import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import type {
  ProviderSetupPreview,
  ProviderSetupResult,
} from "@napier/contracts/provider-setup";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, createServices } from "../src/app.js";

const roots: string[] = [];
const openServices: Awaited<ReturnType<typeof createServices>>[] = [];
const SECRET = "server-provider-setup-secret-never-return";

afterEach(async () => {
  for (const services of openServices.splice(0)) {
    await services.shutdownLocalRuntime();
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Provider setup HTTP", () => {
  it("previews and explicitly enables a locator without creating task state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-setup-http-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
      env: { DEEPSEEK_API_KEY: SECRET },
    });
    openServices.push(services);
    const app = createApp(services);
    const agent = services.store.listAgents()[0]!;
    const revisionCount = services.store.listAgentRevisions(agent.id).length;
    const beforeThreads = services.store.listThreads();

    const previewResponse = await app.request("/api/setup/providers");
    expect(previewResponse.status).toBe(200);
    expect(previewResponse.headers.get("cache-control")).toBe("no-store");
    expect(previewResponse.headers.get("x-napier-content-sha256-mode")).toBe(
      "stable",
    );
    const preview = (await previewResponse.json()) as ProviderSetupPreview;
    expect(previewResponse.headers.get("x-napier-content-sha256")).toBe(
      preview.contentSha256,
    );
    expect(preview.recommendedProviderId).toBe("deepseek");
    expect(JSON.stringify(preview)).not.toContain(SECRET);
    expect(services.store.listCredentialReferences()).toEqual([]);

    const invalidResponse = await app.request("/api/setup/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "deepseek",
        expectedPreviewSha256: preview.contentSha256,
        secret: SECRET,
      }),
    });
    expect(invalidResponse.status).toBe(400);
    expect(services.store.listCredentialReferences()).toEqual([]);

    const staleResponse = await app.request("/api/setup/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "deepseek",
        expectedPreviewSha256: "0".repeat(64),
      }),
    });
    expect(staleResponse.status).toBe(409);
    expect(services.store.listCredentialReferences()).toEqual([]);

    const applyResponse = await app.request("/api/setup/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "deepseek",
        expectedPreviewSha256: preview.contentSha256,
      }),
    });
    expect(applyResponse.status).toBe(200);
    expect(applyResponse.headers.get("cache-control")).toBe("no-store");
    expect(applyResponse.headers.get("x-napier-content-sha256-mode")).toBe(
      "stable",
    );
    const result = (await applyResponse.json()) as ProviderSetupResult;
    expect(applyResponse.headers.get("x-napier-content-sha256")).toBe(
      result.contentSha256,
    );
    expect(result).toEqual(
      expect.objectContaining({
        providerId: "deepseek",
        model: { provider: "deepseek", id: "deepseek-v4-flash" },
        action: "created",
        status: "ready",
      }),
    );
    expect(JSON.stringify(result)).not.toContain(SECRET);

    const bootstrapResponse = await app.request("/api/bootstrap");
    const bootstrap =
      (await bootstrapResponse.json()) as LiveReadyBootstrapResponse;
    expect(bootstrap.recommendedRunModel).toEqual({
      provider: "deepseek",
      id: "deepseek-v4-flash",
    });
    expect(bootstrap.activeThread?.thread.id).toBe(beforeThreads[0]?.id);
    expect(services.store.listThreads()).toEqual(beforeThreads);
    expect(services.store.getAgent(agent.id)).toEqual(agent);
    expect(services.store.listAgentRevisions(agent.id)).toHaveLength(
      revisionCount,
    );
  });
});
