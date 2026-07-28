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
});
