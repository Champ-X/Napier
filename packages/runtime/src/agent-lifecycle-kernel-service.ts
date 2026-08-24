import type { AgentLifecyclePipelineHost } from "./lifecycle-extension-pipeline.js";
import {
  createKernelServiceKey,
  type KernelServiceKey,
  type KernelServiceRegistry,
} from "./kernel-service-registry.js";

export const KERNEL_LIFECYCLE_PIPELINES =
  createKernelServiceKey<AgentLifecyclePipelineHost>(
    "runtime.lifecycle-pipelines",
  );

export function registerAgentLifecyclePipelineService(input: {
  services: KernelServiceRegistry;
  profileKey: KernelServiceKey<unknown>;
  lifecyclePipelines: AgentLifecyclePipelineHost;
}): void {
  input.services.register({
    key: KERNEL_LIFECYCLE_PIPELINES,
    dependencies: [input.profileKey],
    create: () => input.lifecyclePipelines,
    dispose: (pipelines) => pipelines.shutdown(),
  });
}
