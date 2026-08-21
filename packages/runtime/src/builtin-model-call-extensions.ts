import type { LocalStore } from "./store.js";
import type { ComposableAgentModelCallPipeline } from "./kernel-model-call-pipeline.js";
import { installModelHarnessExtension } from "./model-harness-extension.js";
import { installModelContextTokenExtension } from "./model-context-token-extension.js";
import { installToolResultContextExtension } from "./tool-result-context-extension.js";

export function installBuiltinModelCallExtensions(
  pipeline: ComposableAgentModelCallPipeline,
  store: LocalStore,
): void {
  installModelHarnessExtension(pipeline, store);
  installToolResultContextExtension(pipeline, store);
  installModelContextTokenExtension(pipeline, store);
}
