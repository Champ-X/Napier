import { fauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { ModelRegistry } from "../src/models.js";

describe("Model registry", () => {
  it("registers DeepSeek as a first-class live provider", async () => {
    const registry = new ModelRegistry();

    expect(
      registry.resolve({ provider: "deepseek", id: "deepseek-v4-flash" }),
    ).toBeDefined();
    await expect(registry.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "deepseek",
          providerName: "DeepSeek",
          id: "deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          reasoning: true,
          configured: false,
        }),
      ]),
    );
  });

  it("projects executable model availability without model calls", async () => {
    const registry = new ModelRegistry();
    const configured = fauxProvider({ provider: "faux-configured-models" });
    const unconfigured = fauxProvider({
      provider: "faux-unconfigured-models",
    });
    registry.registerProvider(configured.provider);
    registry.registerProvider({
      ...unconfigured.provider,
      auth: {
        apiKey: {
          name: "Unavailable",
          resolve: async () => undefined,
        },
      },
    });

    await expect(
      registry.isConfigured({ provider: "napier", id: "demo" }),
    ).resolves.toBe(true);
    await expect(
      registry.isConfigured({
        provider: "faux-configured-models",
        id: "faux-1",
      }),
    ).resolves.toBe(true);
    await expect(
      registry.isConfigured({
        provider: "faux-unconfigured-models",
        id: "faux-1",
      }),
    ).resolves.toBe(false);
    await expect(
      registry.isConfigured({ provider: "missing", id: "missing-1" }),
    ).resolves.toBe(false);
  });
});
