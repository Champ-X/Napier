import { expect, it } from "vitest";
import { ModelRegistry } from "../src/models.js";
import { bindModelCallRegistry } from "../src/model-call-attribution.js";
import { bindModelRegistryRuntimeSettings, readModelRegistryRuntimeSettings } from "../src/model-registry-runtime-settings.js";

it("distinguishes untrusted model objects from explicitly unaccounted registry composition", () => {
  expect(readModelRegistryRuntimeSettings({ nativeAccounting: false })).toBeUndefined();
  const registry = new ModelRegistry();
  expect(readModelRegistryRuntimeSettings(registry.models)?.nativeAccounting).toBe(false);
  const alias = {};
  bindModelCallRegistry(alias, registry.models);
  expect(readModelRegistryRuntimeSettings(alias)?.nativeAccounting).toBe(false);
  expect(() => bindModelRegistryRuntimeSettings(alias, { nativeAccounting: true, deadlinePolicy: () => undefined }))
    .toThrow("already bound");
});

it("keeps native policy fixed while deadline changes are live detached snapshots", () => {
  const models = {}, policy = { semanticProgressTimeoutMs: 100 };
  bindModelRegistryRuntimeSettings(models, { nativeAccounting: true, deadlinePolicy: () => policy });
  const first = readModelRegistryRuntimeSettings(models)!;
  first.nativeAccounting = false;
  first.deadlinePolicy!.semanticProgressTimeoutMs = 999;
  expect(readModelRegistryRuntimeSettings(models)).toMatchObject({ nativeAccounting: true,
    deadlinePolicy: { semanticProgressTimeoutMs: 100 } });
  policy.semanticProgressTimeoutMs = 200;
  expect(readModelRegistryRuntimeSettings(models)?.deadlinePolicy?.semanticProgressTimeoutMs).toBe(200);
});
