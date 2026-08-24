import type { ComposableAgentModelCallPipeline } from "./kernel-model-call-pipeline.js";
import type { LocalStore } from "./store.js";
import { installModelHarnessExtension } from "./model-harness-extension.js";
import { installModelContextTokenExtension } from "./model-context-token-extension.js";
import { installToolResultContextExtension } from "./tool-result-context-extension.js";
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
  installToolResultContextExtension(pipeline, runtime.store);
  installModelContextTokenExtension(
    pipeline,
    runtime.store,
    runtime.tokenMeters,
  );
}
