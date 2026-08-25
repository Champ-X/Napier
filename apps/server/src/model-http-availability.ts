import type { ModelRef } from "@napier/contracts";
import type { ModelRegistry } from "@napier/runtime/model";

export interface ModelAvailabilityServices {
  models: Pick<ModelRegistry, "resolveConfigured">;
}

export async function assertAvailableModel(
  services: ModelAvailabilityServices,
  model: ModelRef,
): Promise<void> {
  const provider = model.provider.trim().toLowerCase();
  const id = model.id.trim();
  if (provider === "napier" && id === "demo") return;
  await services.models.resolveConfigured({ provider, id });
}
