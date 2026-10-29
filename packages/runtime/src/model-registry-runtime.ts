import {
  createModels,
  type Credential,
  type CredentialStore,
  type MutableModels,
} from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { withDeepSeekVisionModel } from "./deepseek-vision-provider.js";
import { createModelAdapterModels } from "./model-adapters.js";
import { ModelAccountingRegistry } from "./model-accounting-registry.js";
import type { ModelTurnDeadlinePolicy } from "./model-turn-deadline.js";
import type { ToolDeadlinePolicy } from "./tool-deadline-policy.js";

/** Runtime policy and provider wiring shared by the catalog-facing registry. */
export class ModelRegistryRuntime extends ModelAccountingRegistry {
  readonly models: MutableModels;
  readonly credentialReferences?: {
    readReference(referenceId: string): Promise<Credential | undefined>;
  };
  modelTurnDeadlinePolicy?: Partial<ModelTurnDeadlinePolicy>;
  toolDeadlinePolicy?: Partial<ToolDeadlinePolicy>;

  constructor(
    credentials?: CredentialStore,
    admission?: Parameters<typeof createModelAdapterModels>[1],
    accountingRepository?: ConstructorParameters<
      typeof ModelAccountingRegistry
    >[0],
  ) {
    super(accountingRepository);
    if (credentials && "readReference" in credentials) {
      this.credentialReferences = credentials as CredentialStore & {
        readReference(referenceId: string): Promise<Credential | undefined>;
      };
    }
    this.models = createModelAdapterModels(
      createModels({
        ...(credentials ? { credentials } : {}),
        authContext: {
          env: async () => undefined,
          fileExists: async () => false,
        },
      }),
      admission,
    );
    for (const provider of builtinProviders()) {
      this.models.setProvider(withDeepSeekVisionModel(provider));
    }
  }
}
