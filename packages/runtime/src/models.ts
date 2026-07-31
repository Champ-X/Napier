import {
  createModels,
  type Api,
  type CredentialStore,
  type Model,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { ModelRef, ModelSummary } from "@napier/contracts";

export const MAX_MODELS_PER_PROVIDER = 18;
export const MAX_PROJECTED_LIVE_MODELS = 512;

export class ModelRegistry {
  readonly models: MutableModels;

  constructor(credentials?: CredentialStore) {
    const models = createModels(credentials ? { credentials } : undefined);
    for (const provider of builtinProviders()) models.setProvider(provider);
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

  async resolveConfigured(ref: ModelRef): Promise<Model<Api> | undefined> {
    if (ref.provider === "napier" && ref.id === "demo") return undefined;
    const model = this.resolve(ref);
    if (!model) {
      throw new Error(`Model not found: ${ref.provider}/${ref.id}`);
    }
    if (!(await this.isConfigured(ref))) {
      throw new Error(`Model provider is not configured: ${ref.provider}`);
    }
    return model;
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
    const liveModels = projectedProviderModels(providers, this.models).map(
      ({ provider, model }): ModelSummary => ({
        provider: provider.id,
        providerName: provider.name,
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        reasoning: model.reasoning,
        vision: model.input.includes("image"),
        configured: configuredByProvider.get(provider.id) ?? false,
      }),
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

function projectedProviderModels(
  providers: readonly Provider[],
  models: MutableModels,
): Array<{ provider: Provider; model: Model<Api> }> {
  const catalogs = providers.map((provider) => ({
    provider,
    models: models.getModels(provider.id).slice(0, MAX_MODELS_PER_PROVIDER),
  }));
  const projected: Array<{ provider: Provider; model: Model<Api> }> = [];
  for (
    let index = 0;
    index < MAX_MODELS_PER_PROVIDER &&
    projected.length < MAX_PROJECTED_LIVE_MODELS;
    index += 1
  ) {
    for (const catalog of catalogs) {
      const model = catalog.models[index];
      if (model) projected.push({ provider: catalog.provider, model });
      if (projected.length >= MAX_PROJECTED_LIVE_MODELS) break;
    }
  }
  return projected;
}
