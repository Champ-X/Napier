import { modelCallRegistryIdentity } from "./model-call-attribution.js";
import type { ModelTurnDeadlinePolicy } from "./model-turn-deadline.js";

interface ModelRegistryRuntimeSettings {
  nativeAccounting: boolean;
  deadlinePolicy?: Partial<ModelTurnDeadlinePolicy>;
}

const settings = new WeakMap<object, {
  nativeAccounting: boolean;
  deadlinePolicy(): Partial<ModelTurnDeadlinePolicy> | undefined;
}>();

/** Registry composition only; policy authority never travels in model options. */
export function bindModelRegistryRuntimeSettings(
  models: object,
  input: {
    nativeAccounting: boolean;
    deadlinePolicy(): Partial<ModelTurnDeadlinePolicy> | undefined;
  },
): void {
  const identity = modelCallRegistryIdentity(models);
  if (settings.has(identity)) throw new Error("Model registry runtime settings are already bound");
  settings.set(identity, {
    nativeAccounting: input.nativeAccounting,
    deadlinePolicy: input.deadlinePolicy,
  });
}

/** Unbound models are distinct from an explicitly unaccounted registry. */
export function readModelRegistryRuntimeSettings(
  models: object,
): ModelRegistryRuntimeSettings | undefined {
  const binding = settings.get(modelCallRegistryIdentity(models));
  if (!binding) return undefined;
  const deadlinePolicy = binding.deadlinePolicy();
  return {
    nativeAccounting: binding.nativeAccounting,
    ...(deadlinePolicy ? { deadlinePolicy: { ...deadlinePolicy } } : {}),
  };
}
