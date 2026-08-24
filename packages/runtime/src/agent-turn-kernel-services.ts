import type { AgentRuntime } from "./agent-runtime.js";
import type { AgentLifecyclePipelineHost } from "./lifecycle-extension-pipeline.js";
export { KERNEL_LIFECYCLE_PIPELINES } from "./agent-lifecycle-kernel-service.js";
import {
  AgentTurnPipeline,
  DEFAULT_AGENT_TURN_POLICY_ADAPTER,
  DEFAULT_AGENT_TURN_PROMPT_ADAPTER,
  DEFAULT_AGENT_TURN_TOOL_ADAPTER,
  type AgentTurnPipelineAdapters,
  type AgentTurnPolicyAdapter,
  type AgentTurnPromptAdapter,
  type AgentTurnToolAdapter,
} from "./agent-turn-pipeline.js";
import type { AgentTurnModelCallPipeline } from "./kernel-model-call-pipeline.js";
import {
  createKernelServiceKey,
  type KernelServiceKey,
  type KernelServiceRegistry,
} from "./kernel-service-registry.js";

export type KernelPromptAdapter = AgentTurnPromptAdapter;
export type KernelToolAdapter = AgentTurnToolAdapter;
export type KernelPolicyAdapter = AgentTurnPolicyAdapter;

export const KERNEL_PROMPT_ADAPTER =
  createKernelServiceKey<KernelPromptAdapter>("runtime.prompt");
export const KERNEL_TOOL_ADAPTER =
  createKernelServiceKey<KernelToolAdapter>("runtime.tool");
export const KERNEL_POLICY_ADAPTER =
  createKernelServiceKey<KernelPolicyAdapter>("runtime.policy");
export const KERNEL_TURN_PIPELINE = createKernelServiceKey<AgentTurnPipeline>(
  "runtime.turn-pipeline",
);

export function registerAgentTurnPipelineServices(input: {
  services: KernelServiceRegistry;
  profileKey: KernelServiceKey<unknown>;
  adapters?: Partial<AgentTurnPipelineAdapters>;
}): void {
  input.services.register({
    key: KERNEL_PROMPT_ADAPTER,
    dependencies: [input.profileKey],
    create: () => input.adapters?.prompt ?? DEFAULT_AGENT_TURN_PROMPT_ADAPTER,
  });
  input.services.register({
    key: KERNEL_TOOL_ADAPTER,
    dependencies: [input.profileKey],
    create: () => input.adapters?.tool ?? DEFAULT_AGENT_TURN_TOOL_ADAPTER,
  });
  input.services.register({
    key: KERNEL_POLICY_ADAPTER,
    dependencies: [input.profileKey],
    create: () => input.adapters?.policy ?? DEFAULT_AGENT_TURN_POLICY_ADAPTER,
  });
  input.services.register({
    key: KERNEL_TURN_PIPELINE,
    dependencies: [
      input.profileKey,
      KERNEL_PROMPT_ADAPTER,
      KERNEL_TOOL_ADAPTER,
      KERNEL_POLICY_ADAPTER,
    ],
    create: (resolver) =>
      new AgentTurnPipeline({
        prompt: resolver.require(KERNEL_PROMPT_ADAPTER),
        tool: resolver.require(KERNEL_TOOL_ADAPTER),
        policy: resolver.require(KERNEL_POLICY_ADAPTER),
      }),
  });
}

export function attachAgentRuntimePipelines(
  runtime: AgentRuntime,
  turnPipeline: AgentTurnPipeline,
  modelCalls: AgentTurnModelCallPipeline,
  lifecyclePipelines: AgentLifecyclePipelineHost,
): () => void {
  const detachTurnPipeline = runtime.attachKernelTurnPipeline(turnPipeline);
  try {
    const detachModelCalls = runtime.attachKernelModelCallPipeline(modelCalls);
    try {
      const detachLifecycles =
        runtime.attachKernelLifecyclePipelines(lifecyclePipelines);
      return () => {
        detachLifecycles();
        detachModelCalls();
        detachTurnPipeline();
      };
    } catch (error) {
      detachModelCalls();
      throw error;
    }
  } catch (error) {
    detachTurnPipeline();
    throw error;
  }
}
