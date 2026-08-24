import {
  type KernelHookHandler,
  type KernelHookName,
  KernelHookRegistry,
} from "./kernel-hooks.js";
import {
  type KernelServiceRegistration,
  KernelServiceRegistry,
} from "./kernel-service-registry.js";
import {
  type AgentModelCallExtension,
  ComposableAgentModelCallPipeline,
} from "./kernel-model-call-pipeline.js";
import {
  type AgentCompletionLifecycleContext,
  type AgentStepLifecycleContext,
  type AgentToolLifecycleContext,
  AgentLifecyclePipelineHost,
  type LifecycleExtension,
  type LifecycleExtensionEffect,
} from "./lifecycle-extension-pipeline.js";

export class AgentKernelScope {
  readonly services;
  readonly hooks;
  private disposed = false;

  constructor(
    registry: KernelServiceRegistry,
    hookRegistry: KernelHookRegistry,
    private readonly modelCalls: ComposableAgentModelCallPipeline,
    private readonly lifecycles: AgentLifecyclePipelineHost,
    readonly owner: string,
  ) {
    this.services = registry.scope(owner);
    this.hooks = hookRegistry.scope(owner);
  }

  register<T>(registration: KernelServiceRegistration<T>): void {
    this.assertActive();
    this.services.register(registration);
  }

  on<Name extends KernelHookName>(
    name: Name,
    handler: KernelHookHandler<Name>,
  ): () => void {
    this.assertActive();
    return this.hooks.on(name, handler);
  }

  interceptModelCall(extension: AgentModelCallExtension): () => void {
    this.assertActive();
    return this.modelCalls.use(extension, this.owner);
  }

  interceptStep(
    extension: LifecycleExtension<AgentStepLifecycleContext>,
  ): LifecycleExtensionEffect {
    this.assertActive();
    return this.lifecycles.step.use(extension, this.owner);
  }

  interceptTool(
    extension: LifecycleExtension<AgentToolLifecycleContext>,
  ): LifecycleExtensionEffect {
    this.assertActive();
    return this.lifecycles.tool.use(extension, this.owner);
  }

  interceptCompletion(
    extension: LifecycleExtension<AgentCompletionLifecycleContext>,
  ): LifecycleExtensionEffect {
    this.assertActive();
    return this.lifecycles.completion.use(extension, this.owner);
  }

  resolve(): Promise<void> {
    this.assertActive();
    return this.services.resolve();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.hooks.dispose();
    this.modelCalls.disposeOwner(this.owner);
    this.disposed = true;
    const settlements = await Promise.allSettled([
      this.lifecycles.disposeOwner(this.owner),
      this.services.dispose(),
    ]);
    const failure = settlements.find(
      (settlement): settlement is PromiseRejectedResult =>
        settlement.status === "rejected",
    );
    if (failure) throw failure.reason;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error(`Kernel plugin is disposed: ${this.owner}`);
    }
  }
}
