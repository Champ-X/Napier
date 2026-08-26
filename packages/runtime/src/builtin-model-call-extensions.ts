import type { ComposableAgentModelCallPipeline } from "./kernel-model-call-pipeline.js";
import type { LocalStore } from "./store.js";
import { installContextProjectionService } from "./context-projection-service.js";
import { installModelHarnessExtension } from "./model-harness-extension.js";
import type { TokenMeterRegistry } from "./token-meter-provider.js";

interface BuiltinModelCallExtensionHost {
  store: LocalStore;
  tokenMeters: TokenMeterRegistry;
}

export function installBuiltinModelCallExtensions(
  pipeline: ComposableAgentModelCallPipeline,
  runtime: BuiltinModelCallExtensionHost,
): void {
  installModelHarnessExtension(pipeline, runtime.store);
  installContextProjectionService(pipeline, runtime.store, runtime.tokenMeters);
}
