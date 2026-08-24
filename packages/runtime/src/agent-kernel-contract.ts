import type { KernelPluginInspection } from "@napier/contracts/kernel-plugins";

import type { KernelCompletionControlProjection } from "./kernel-completion-control.js";
import type { KernelHookName } from "./kernel-hooks.js";
import type { AgentModelCallExtensionInspection } from "./kernel-model-call-pipeline.js";
import type { ResolvedKernelProfile } from "./kernel-profile.js";
import type { KernelServiceInspection } from "./kernel-service-registry.js";
import type { AgentLifecyclePipelineInspection } from "./lifecycle-extension-pipeline.js";
import type { AgentTurnPipelineInspection } from "./agent-turn-pipeline.js";
import type { ModelRegistry } from "./models.js";
import type { ComposableAgentModelCallPipeline } from "./kernel-model-call-pipeline.js";

export interface KernelModelAdapter {
  registry: ModelRegistry;
  pipeline: ComposableAgentModelCallPipeline;
}

export interface AgentKernelInspection {
  profile: ResolvedKernelProfile;
  plugins: KernelPluginInspection[];
  services: KernelServiceInspection[];
  hooks: Array<{ name: KernelHookName; owners: string[]; count: number }>;
  modelCalls: AgentModelCallExtensionInspection[];
  lifecyclePipelines: AgentLifecyclePipelineInspection;
  turnPipeline: AgentTurnPipelineInspection;
  completionControl: KernelCompletionControlProjection;
}
