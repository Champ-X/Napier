import type { WebSearchExecutor } from "./web-search-model.js";
import { createKernelPluginManifest } from "./kernel-plugin-manifest.js";
import type { KernelPluginDefinition } from "./kernel-plugin-registry.js";
import { createKernelServiceKey } from "./kernel-service-registry.js";

export const SEARCH_KERNEL_PLUGIN_ID = "plugin.search";
export const SEARCH_KERNEL_PLUGIN_VERSION = "1.0.0";
export const KERNEL_WEB_SEARCH =
  createKernelServiceKey<WebSearchExecutor>("runtime.web-search");

export class DynamicWebSearchExecutor implements WebSearchExecutor {
  private executor: WebSearchExecutor | undefined;

  available(): boolean {
    return this.executor !== undefined;
  }

  attach(executor: WebSearchExecutor): void {
    if (this.executor) {
      throw new Error("Web Search plugin executor is already attached");
    }
    this.executor = executor;
  }

  detach(executor: WebSearchExecutor): void {
    if (this.executor === executor) this.executor = undefined;
  }

  search(
    request: Parameters<WebSearchExecutor["search"]>[0],
    signal?: AbortSignal,
  ) {
    if (!this.executor) {
      throw new Error("Web Search plugin is disabled");
    }
    return this.executor.search(request, signal);
  }
}

export function createSearchKernelPlugin(input: {
  slot: DynamicWebSearchExecutor;
  executor: WebSearchExecutor;
}): KernelPluginDefinition {
  return {
    manifest: createKernelPluginManifest({
      id: SEARCH_KERNEL_PLUGIN_ID,
      version: SEARCH_KERNEL_PLUGIN_VERSION,
      displayName: "Search",
      description:
        "Provides policy-bounded live public Web Search with provider fallback.",
      trust: "first_party",
      dependencies: [],
      capabilities: ["tool"],
      permissions: ["network.public"],
      entries: {
        host: {
          package: "@napier/runtime",
          export: "./kernel-search-plugin",
        },
      },
      contributions: {
        tools: ["web_search"],
        providers: [],
        prompts: [],
        projections: [],
        uiSlots: [],
      },
    }),
    setup(scope) {
      scope.register({
        key: KERNEL_WEB_SEARCH,
        create: () => {
          input.slot.attach(input.executor);
          return input.executor;
        },
        dispose: (executor) => input.slot.detach(executor),
      });
    },
  };
}
