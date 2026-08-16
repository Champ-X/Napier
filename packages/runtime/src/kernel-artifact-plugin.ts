import type { AgentRuntime } from "./agent-runtime.js";
import { ConversationArtifactsProjectionService } from "./kernel-detail-projections.js";
import { createKernelPluginManifest } from "./kernel-plugin-manifest.js";
import type { KernelPluginDefinition } from "./kernel-plugin-registry.js";
import type { KernelProjectionRegistry } from "./kernel-projections.js";
import type { KernelServiceKey } from "./kernel-service-registry.js";

export const ARTIFACT_KERNEL_PLUGIN_ID = "plugin.artifact";
export const ARTIFACT_KERNEL_PLUGIN_VERSION = "1.0.0";

export function createArtifactKernelPlugin(input: {
  serviceKey: KernelServiceKey<ConversationArtifactsProjectionService>;
  projectionRegistryKey: KernelServiceKey<KernelProjectionRegistry>;
  runtimeKey: KernelServiceKey<AgentRuntime>;
  store: AgentRuntime["store"];
}): KernelPluginDefinition {
  return {
    manifest: createKernelPluginManifest({
      id: ARTIFACT_KERNEL_PLUGIN_ID,
      version: ARTIFACT_KERNEL_PLUGIN_VERSION,
      displayName: "Artifact",
      description:
        "Projects authoritative Plan artifact state for the Conversation Feed.",
      trust: "first_party",
      dependencies: [],
      capabilities: ["projection"],
      permissions: [],
      entries: {
        host: {
          package: "@napier/runtime",
          export: "./kernel-artifact-plugin",
        },
      },
      contributions: {
        tools: [],
        providers: [],
        prompts: [],
        projections: ["conversation.artifacts"],
        uiSlots: [],
      },
    }),
    setup(scope) {
      scope.register({
        key: input.serviceKey,
        dependencies: [input.projectionRegistryKey, input.runtimeKey],
        create: (resolver) =>
          new ConversationArtifactsProjectionService(
            resolver.require(input.projectionRegistryKey),
            input.store,
            ARTIFACT_KERNEL_PLUGIN_ID,
          ),
        dispose: (service) => service.dispose(),
      });
    },
  };
}
