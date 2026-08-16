import type { AgentRuntime } from "./agent-runtime.js";
import {
  createArtifactKernelPlugin,
  ARTIFACT_KERNEL_PLUGIN_ID,
} from "./kernel-artifact-plugin.js";
import {
  createSearchKernelPlugin,
  type DynamicWebSearchExecutor,
  SEARCH_KERNEL_PLUGIN_ID,
} from "./kernel-search-plugin.js";
import type { KernelPluginRegistry } from "./kernel-plugin-registry.js";
import type { KernelProjectionRegistry } from "./kernel-projections.js";
import type { KernelServiceKey } from "./kernel-service-registry.js";
import type { ConversationArtifactsProjectionService } from "./kernel-detail-projections.js";
import type { WebSearchExecutor } from "./web-search-model.js";
import {
  createBrowserKernelPlugin,
  type DynamicBrowserSessionPort,
  BROWSER_KERNEL_PLUGIN_ID,
} from "./kernel-browser-plugin.js";
import type { RunBrowserSessionManager } from "./browser-session.js";

export interface KernelBuiltinSearchInput {
  slot: DynamicWebSearchExecutor;
  executor: WebSearchExecutor;
}

export interface KernelBuiltinBrowserInput {
  slot: DynamicBrowserSessionPort;
  manager:
    | RunBrowserSessionManager
    | (import("./browser-session-port.js").BrowserSessionPort & {
        shutdown?(): Promise<void>;
      });
}

export async function installBuiltinKernelPlugins(input: {
  plugins: KernelPluginRegistry;
  artifact: {
    serviceKey: KernelServiceKey<ConversationArtifactsProjectionService>;
    projectionRegistryKey: KernelServiceKey<KernelProjectionRegistry>;
    runtimeKey: KernelServiceKey<AgentRuntime>;
    store: AgentRuntime["store"];
  };
  search?: KernelBuiltinSearchInput;
  browser?: KernelBuiltinBrowserInput;
}): Promise<void> {
  input.plugins.install(createArtifactKernelPlugin(input.artifact));
  await input.plugins.enable(ARTIFACT_KERNEL_PLUGIN_ID);
  if (input.search) {
    input.plugins.install(createSearchKernelPlugin(input.search));
    await input.plugins.enable(SEARCH_KERNEL_PLUGIN_ID);
  }
  if (input.browser) {
    input.plugins.install(createBrowserKernelPlugin(input.browser));
    await input.plugins.enable(BROWSER_KERNEL_PLUGIN_ID);
  }
}
