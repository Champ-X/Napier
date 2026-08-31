import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { BootstrapResponse, CredentialReference } from "@napier/contracts";
import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import { UnsupportedSandboxAdapter } from "@napier/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp, createServices } from "../src/app.js";

const roots: string[] = [];
const openServices: Awaited<ReturnType<typeof createServices>>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const services of openServices.splice(0)) {
    await services.workspaceProcesses.shutdown();
    await services.extensions.shutdown();
    services.store.close();
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Pi built-in model catalog HTTP projection", () => {
  it("exposes bounded Provider choices while missing credentials fail closed", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "PRIVATE_AMBIENT_SERVER_KEY");
    const root = await mkdtemp(path.join(tmpdir(), "napier-model-catalog-"));
    roots.push(root);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(
        new Error("bootstrap model registration and listing must stay offline"),
      );
    const services = await createServices({
      workspaceRoot: path.join(root, "workspace"),
      dataRoot: path.join(root, "data"),
      sandbox: new UnsupportedSandboxAdapter("model-catalog-test"),
    });
    openServices.push(services);
    const app = createApp(services);

    const bootstrapResponse = await app.request("/api/bootstrap");
    const bootstrap =
      (await bootstrapResponse.json()) as LiveReadyBootstrapResponse;

    expect(bootstrapResponse.status).toBe(200);
    expect(
      Buffer.byteLength(JSON.stringify(bootstrap.models), "utf8"),
    ).toBeLessThan(128 * 1024);
    expect(
      new Set(bootstrap.models.map((model) => model.provider)).size,
    ).toBeGreaterThanOrEqual(35);
    for (const provider of [
      "anthropic",
      "azure-openai-responses",
      "github-copilot",
      "google",
      "groq",
      "mistral",
      "openai-codex",
      "opencode",
      "qwen-token-plan-cn",
      "xai",
    ]) {
      expect(
        bootstrap.models.some((model) => model.provider === provider),
      ).toBe(true);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(
      bootstrap.models.find(
        (model) =>
          model.provider === "deepseek" &&
          model.id === "deepseek-v4-flash-vision-exp",
      ),
    ).toEqual(expect.objectContaining({ configured: false, vision: true }));
    expect(bootstrap.recommendedRunModel).toEqual({
      provider: "napier",
      id: "demo",
    });
    fetch.mockRestore();

    const deepSeekCredential = await app.request("/api/credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "deepseek",
        label: "DeepSeek environment",
        source: {
          type: "environment",
          variable: "DEEPSEEK_API_KEY",
        },
      }),
    });
    expect(deepSeekCredential.status).toBe(201);
    const liveReady = (await (
      await app.request("/api/bootstrap")
    ).json()) as LiveReadyBootstrapResponse;
    expect(
      liveReady.models.find(
        (model) =>
          model.provider === "deepseek" &&
          model.id === "deepseek-v4-flash-vision-exp",
      ),
    ).toEqual(expect.objectContaining({ configured: true, vision: true }));
    expect(liveReady.recommendedRunModel).toEqual({
      provider: "deepseek",
      id: "deepseek-v4-flash-vision-exp",
    });
    expect(JSON.stringify(liveReady)).not.toContain(
      "PRIVATE_AMBIENT_SERVER_KEY",
    );

    const credentialResponse = await app.request("/api/credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "groq",
        label: "Groq environment",
        source: {
          type: "environment",
          variable: "NAPIER_SERVER_MISSING_GROQ_KEY",
        },
      }),
    });
    expect(credentialResponse.status).toBe(201);
    expect((await credentialResponse.json()) as CredentialReference).toEqual(
      expect.objectContaining({
        providerId: "groq",
        availability: "unknown",
      }),
    );

    const agent = services.store.listAgents()[0]!;
    const groqModel = getBuiltinModels("groq")[0]!;
    const update = await app.request(`/api/agents/${agent.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: { provider: "groq", id: groqModel.id },
      }),
    });
    expect(update.status).toBe(400);
    expect(await update.json()).toEqual(
      expect.objectContaining({
        error: "Model provider is not configured: groq",
      }),
    );

    const models = (
      (await (await app.request("/api/bootstrap")).json()) as BootstrapResponse
    ).models;
    expect(
      models.find(
        (model) => model.provider === "groq" && model.id === groqModel.id,
      ),
    ).toEqual(expect.objectContaining({ configured: false }));
  });
});
