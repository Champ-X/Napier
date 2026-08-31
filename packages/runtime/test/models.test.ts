import {
  fauxProvider,
  type Credential,
  type CredentialStore,
} from "@earendil-works/pi-ai";
import {
  builtinProviders,
  getBuiltinModels,
  getBuiltinProviders,
} from "@earendil-works/pi-ai/providers/all";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEEPSEEK_API_BASE_URL,
  DEEPSEEK_VISION_MODEL_ID,
} from "../src/deepseek-vision-provider.js";
import {
  MAX_MODELS_PER_PROVIDER,
  MAX_PROJECTED_LIVE_MODELS,
  ModelRegistry,
} from "../src/models.js";

afterEach(() => {
  vi.restoreAllMocks();
});

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
        expect.objectContaining({
          provider: "deepseek",
          providerName: "DeepSeek",
          id: DEEPSEEK_VISION_MODEL_ID,
          reasoning: false,
          vision: true,
          configured: false,
        }),
      ]),
    );
  });

  it("serializes DeepSeek vision input as an OpenAI-compatible image_url user block", async () => {
    const registry = new ModelRegistry(
      credentialStore({
        deepseek: { type: "api_key", key: "PRIVATE_DEEPSEEK_KEY" },
      }),
    );
    const model = registry.resolve({
      provider: "deepseek",
      id: DEEPSEEK_VISION_MODEL_ID,
    });
    expect(model).toEqual(
      expect.objectContaining({
        api: "openai-completions",
        baseUrl: DEEPSEEK_API_BASE_URL,
        input: ["text", "image"],
      }),
    );

    let payload: unknown;
    const stream = registry.models.streamSimple(
      model!,
      {
        messages: [
          {
            role: "user",
            timestamp: 1,
            content: [
              { type: "text", text: "Describe this image" },
              { type: "image", mimeType: "image/png", data: "iVBORw==" },
            ],
          },
        ],
      },
      {
        onPayload(value) {
          payload = value;
          throw new Error("payload captured before network dispatch");
        },
      },
    );
    for await (const _event of stream) {
      // The deliberate onPayload error terminates the provider stream offline.
    }

    expect(payload).toEqual(
      expect.objectContaining({
        model: DEEPSEEK_VISION_MODEL_ID,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this image" },
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,iVBORw==" },
              },
            ],
          },
        ],
      }),
    );
  });

  it("does not treat ambient environment secrets as configured credentials", async () => {
    const previous = process.env["DEEPSEEK_API_KEY"];
    process.env["DEEPSEEK_API_KEY"] = "PRIVATE_AMBIENT_DEEPSEEK_KEY";
    try {
      const registry = new ModelRegistry();

      await expect(
        registry.isConfigured({
          provider: "deepseek",
          id: "deepseek-v4-flash",
        }),
      ).resolves.toBe(false);
      await expect(registry.list()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            provider: "deepseek",
            configured: false,
          }),
        ]),
      );
    } finally {
      if (previous === undefined) delete process.env["DEEPSEEK_API_KEY"];
      else process.env["DEEPSEEK_API_KEY"] = previous;
    }
  });

  it("registers the complete pinned Pi provider catalog with a bounded fair projection", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("model listing must not use network"));
    const registry = new ModelRegistry();
    const list = await registry.list();
    const live = list.filter((model) => model.provider !== "napier");
    const projectedProviders = new Set(live.map((model) => model.provider));
    const staticProviders = getBuiltinProviders().filter(
      (provider) => getBuiltinModels(provider).length > 0,
    );

    expect(
      registry.models.getProviders().map((provider) => provider.id),
    ).toEqual(builtinProviders().map((provider) => provider.id));
    expect(
      staticProviders.every((provider) => projectedProviders.has(provider)),
    ).toBe(true);
    expect(live.length).toBeLessThanOrEqual(MAX_PROJECTED_LIVE_MODELS);
    expect(list).toHaveLength(live.length + 1);
    expect(Buffer.byteLength(JSON.stringify(list), "utf8")).toBeLessThan(
      128 * 1024,
    );
    for (const provider of projectedProviders) {
      expect(
        live.filter((model) => model.provider === provider).length,
      ).toBeLessThanOrEqual(MAX_MODELS_PER_PROVIDER);
    }
    expect(fetch).not.toHaveBeenCalled();

    for (const provider of [
      "anthropic",
      "azure-openai-responses",
      "github-copilot",
      "google",
      "groq",
      "mistral",
      "openai",
      "openai-codex",
      "opencode",
      "qwen-token-plan-cn",
      "xai",
    ]) {
      expect(projectedProviders).toContain(provider);
    }
    const openRouterCatalog = getBuiltinModels("openrouter");
    const unprojected = openRouterCatalog[MAX_MODELS_PER_PROVIDER];
    expect(unprojected).toBeDefined();
    expect(
      list.some(
        (model) =>
          model.provider === "openrouter" && model.id === unprojected?.id,
      ),
    ).toBe(false);
    expect(
      registry.resolve({
        provider: "openrouter",
        id: unprojected!.id,
      }),
    ).toBeDefined();
  });

  it("uses existing credential references for newly exposed API-key providers", async () => {
    const credentials = credentialStore({
      groq: { type: "api_key", key: "PRIVATE_GROQ_KEY" },
    });
    const registry = new ModelRegistry(credentials);
    const model = getBuiltinModels("groq")[0]!;

    await expect(
      registry.isConfigured({ provider: "groq", id: model.id }),
    ).resolves.toBe(true);
    await expect(
      registry.resolveConfigured({ provider: "groq", id: model.id }),
    ).resolves.toEqual(expect.objectContaining({ provider: "groq" }));
    await expect(registry.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "groq",
          configured: true,
        }),
      ]),
    );
  });

  it("recommends an active referenced live model without changing the Agent", async () => {
    const credentials = credentialStore({
      deepseek: { type: "api_key", key: "PRIVATE_DEEPSEEK_KEY" },
    });
    const registry = new ModelRegistry(credentials);
    const agent = {
      id: "agent_napier",
      model: { provider: "napier", id: "demo" },
    };

    await expect(
      registry.recommendDefaultRunModel(
        agent,
        [
          {
            id: "credential_deepseek_12345678",
            providerId: "deepseek",
            label: "DeepSeek",
            source: {
              type: "environment",
              variable: "DEEPSEEK_API_KEY",
            },
            status: "active",
            availability: "available",
            revision: 1,
            createdAt: "2026-08-05T00:00:00.000Z",
            updatedAt: "2026-08-05T00:00:00.000Z",
          },
        ],
        [{ revision: 1, changedFields: [] }],
      ),
    ).resolves.toEqual({
      provider: "deepseek",
      id: DEEPSEEK_VISION_MODEL_ID,
    });
    expect(agent.model).toEqual({ provider: "napier", id: "demo" });
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

  it("resolves only executable live models through one failure contract", async () => {
    const registry = new ModelRegistry();
    const configured = fauxProvider({ provider: "faux-resolve-configured" });
    const unconfigured = fauxProvider({
      provider: "faux-resolve-unconfigured",
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
      registry.resolveConfigured({ provider: "napier", id: "demo" }),
    ).resolves.toBeUndefined();
    await expect(
      registry.resolveConfigured({
        provider: "faux-resolve-configured",
        id: "faux-1",
      }),
    ).resolves.toEqual(expect.objectContaining({ id: "faux-1" }));
    await expect(
      registry.resolveConfigured({
        provider: "faux-resolve-unconfigured",
        id: "faux-1",
      }),
    ).rejects.toThrow(
      "Model provider is not configured: faux-resolve-unconfigured",
    );
    await expect(
      registry.resolveConfigured({ provider: "missing", id: "missing-1" }),
    ).rejects.toThrow("Model not found: missing/missing-1");
  });
});

function credentialStore(values: Record<string, Credential>): CredentialStore {
  return {
    async read(providerId) {
      return values[providerId];
    },
    async list() {
      return Object.entries(values).map(([providerId, credential]) => ({
        providerId,
        type: credential.type,
      }));
    },
    async modify(providerId, fn) {
      const next = await fn(values[providerId]);
      if (next) values[providerId] = next;
      return values[providerId];
    },
    async delete(providerId) {
      delete values[providerId];
    },
  };
}
