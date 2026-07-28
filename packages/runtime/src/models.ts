import {
  createModels,
  type Api,
  type CredentialStore,
  type Model,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { ModelRef, ModelSummary } from "@napier/contracts";

const MAX_MODELS_PER_PROVIDER = 18;

export class ModelRegistry {
  readonly models: MutableModels;

  constructor(credentials?: CredentialStore) {
    const models = createModels(credentials ? { credentials } : undefined);
    models.setProvider(openaiProvider());
    models.setProvider(anthropicProvider());
    models.setProvider(deepseekProvider());
    models.setProvider(googleProvider());
    models.setProvider(openrouterProvider());
    this.models = models;
  }

  registerProvider(provider: Provider<Api>): void {
    this.models.setProvider(provider);
  }

  resolve(ref: ModelRef): Model<Api> | undefined {
    if (ref.provider === "napier" && ref.id === "demo") return undefined;
    return this.models.getModel(ref.provider, ref.id);
  }

  async isConfigured(ref: ModelRef): Promise<boolean> {
    if (ref.provider === "napier" && ref.id === "demo") return true;
    const model = this.resolve(ref);
    if (!model) return false;
    try {
      const available = await this.models.getAvailable(ref.provider);
      return available.some((candidate) => candidate.id === ref.id);
    } catch {
      return false;
    }
  }

  async list(): Promise<ModelSummary[]> {
    const providers = this.models.getProviders();
    const configuredEntries = await Promise.all(
      providers.map(async (provider) => {
        try {
          return [
            provider.id,
            Boolean(await this.models.checkAuth(provider.id)),
          ] as const;
        } catch {
          return [provider.id, false] as const;
        }
      }),
    );
    const configuredByProvider = new Map(configuredEntries);
    const liveModels = providers.flatMap((provider) =>
      this.models
        .getModels(provider.id)
        .slice(0, MAX_MODELS_PER_PROVIDER)
        .map(
          (model): ModelSummary => ({
            provider: provider.id,
            providerName: provider.name,
            id: model.id,
            name: model.name,
            contextWindow: model.contextWindow,
            reasoning: model.reasoning,
            vision: model.input.includes("image"),
            configured: configuredByProvider.get(provider.id) ?? false,
          }),
        ),
    );

    return [
      {
        provider: "napier",
        providerName: "Napier",
        id: "demo",
        name: "Deterministic demo",
        contextWindow: 32_000,
        reasoning: true,
        vision: false,
        configured: true,
      },
      ...liveModels.sort((left, right) => {
        if (left.configured !== right.configured)
          return left.configured ? -1 : 1;
        return `${left.provider}/${left.name}`.localeCompare(
          `${right.provider}/${right.name}`,
        );
      }),
    ];
  }
}
