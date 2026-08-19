import type { RunRecord } from "@napier/contracts";
import type { KernelPluginInspection } from "@napier/contracts/kernel-plugins";
import { createAgentPromptBuilder } from "./agent-prompt-builder.js";
import type {
  ContinueOperatorDecisionOptions,
  ResumeInterruptedRunAutomaticallyOptions,
  ResumeInterruptedRunOptions,
  RunPromptOptions,
} from "./agent-runtime-options.js";
import type { AgentRuntime } from "./agent-runtime.js";
import { AgentKernelScope } from "./agent-kernel-scope.js";
import { KernelHookRegistry, type KernelHookName } from "./kernel-hooks.js";
import {
  composeEventSink,
  KernelCompletionControlObserver,
  type KernelCompletionControlProjection,
} from "./kernel-completion-control.js";
import {
  resolveKernelProfile,
  type KernelProfileId,
  type ResolvedKernelProfile,
} from "./kernel-profile.js";
import { KernelPluginRegistry } from "./kernel-plugin-registry.js";
import {
  createKernelServiceKey,
  KernelServiceRegistry,
  type KernelServiceInspection,
} from "./kernel-service-registry.js";
import {
  KernelProjectionRegistry,
  TaskNarrativeProjectionService,
  ThreadSummaryProjectionService,
} from "./kernel-projections.js";
import {
  ActivePlanProjectionService,
  ConversationArtifactsProjectionService,
  ConversationActivityEventsProjectionService,
  ConversationCitationsProjectionService,
  ConversationMessagesProjectionService,
  OperatorDecisionsProjectionService,
} from "./kernel-detail-projections.js";
import type { ModelRegistry } from "./models.js";
import { preflightAgentToolPolicy } from "./agent-tool-policy-preflight.js";
import { createWorkspaceTools } from "./tools.js";
import {
  installBuiltinKernelPlugins,
  type KernelBuiltinBrowserInput,
  type KernelBuiltinSearchInput,
} from "./kernel-builtin-plugins.js";
import { ConversationActivityCandidatesProjectionService } from "./kernel-activity-candidates-projection.js";
import { ConversationPlansProjectionService } from "./kernel-conversation-plans-projection.js";
import { ConversationRecoveriesProjectionService } from "./kernel-recovery-projection.js";
import { ConversationSubagentsProjectionService } from "./kernel-subagent-projection.js";
import {
  ComposableAgentModelCallPipeline,
  type AgentModelCallExtensionInspection,
} from "./kernel-model-call-pipeline.js";
import { installBuiltinModelCallExtensions } from "./builtin-model-call-extensions.js";
export interface KernelModelAdapter {
  registry: ModelRegistry;
  pipeline: ComposableAgentModelCallPipeline;
}
export interface KernelPromptAdapter {
  create: typeof createAgentPromptBuilder;
}
export interface KernelToolAdapter {
  createWorkspaceTools: typeof createWorkspaceTools;
}
export interface KernelPolicyAdapter {
  preflight: typeof preflightAgentToolPolicy;
}

export interface AgentKernelInspection {
  profile: ResolvedKernelProfile;
  plugins: KernelPluginInspection[];
  services: KernelServiceInspection[];
  hooks: Array<{ name: KernelHookName; owners: string[]; count: number }>;
  modelCalls: AgentModelCallExtensionInspection[];
  completionControl: KernelCompletionControlProjection;
}

export const KERNEL_PROFILE =
  createKernelServiceKey<ResolvedKernelProfile>("kernel.profile");
export const KERNEL_AGENT_RUNTIME =
  createKernelServiceKey<AgentRuntime>("runtime.agent");
export const KERNEL_MODEL_ADAPTER =
  createKernelServiceKey<KernelModelAdapter>("runtime.model");
export const KERNEL_MODEL_CALL_PIPELINE =
  createKernelServiceKey<ComposableAgentModelCallPipeline>(
    "runtime.model-call-pipeline",
  );
export const KERNEL_PROMPT_ADAPTER =
  createKernelServiceKey<KernelPromptAdapter>("runtime.prompt");
export const KERNEL_TOOL_ADAPTER =
  createKernelServiceKey<KernelToolAdapter>("runtime.tool");
export const KERNEL_POLICY_ADAPTER =
  createKernelServiceKey<KernelPolicyAdapter>("runtime.policy");
export const KERNEL_COMPLETION_CONTROL =
  createKernelServiceKey<KernelCompletionControlObserver>(
    "runtime.completion-control",
  );
export const KERNEL_PROJECTION_REGISTRY =
  createKernelServiceKey<KernelProjectionRegistry>("projection.registry");
export const KERNEL_THREAD_SUMMARIES =
  createKernelServiceKey<ThreadSummaryProjectionService>(
    "projection.thread-summary",
  );
export const KERNEL_TASK_NARRATIVES =
  createKernelServiceKey<TaskNarrativeProjectionService>(
    "projection.task-narrative",
  );
export const KERNEL_ACTIVE_PLANS =
  createKernelServiceKey<ActivePlanProjectionService>("projection.active-plan");
export const KERNEL_CONVERSATION_MESSAGES =
  createKernelServiceKey<ConversationMessagesProjectionService>(
    "projection.conversation-messages",
  );
export const KERNEL_CONVERSATION_ARTIFACTS =
  createKernelServiceKey<ConversationArtifactsProjectionService>(
    "projection.conversation-artifacts",
  );
export const KERNEL_CONVERSATION_ACTIVITY_EVENTS =
  createKernelServiceKey<ConversationActivityEventsProjectionService>(
    "projection.conversation-activity-events",
  );
export const KERNEL_CONVERSATION_ACTIVITY_CANDIDATES =
  createKernelServiceKey<ConversationActivityCandidatesProjectionService>(
    "projection.conversation-activity-candidates",
  );
export const KERNEL_CONVERSATION_PLANS =
  createKernelServiceKey<ConversationPlansProjectionService>(
    "projection.conversation-plans",
  );
export const KERNEL_CONVERSATION_CITATIONS =
  createKernelServiceKey<ConversationCitationsProjectionService>(
    "projection.conversation-citations",
  );
export const KERNEL_CONVERSATION_RECOVERIES =
  createKernelServiceKey<ConversationRecoveriesProjectionService>(
    "projection.current-recovery",
  );
export const KERNEL_CONVERSATION_SUBAGENTS =
  createKernelServiceKey<ConversationSubagentsProjectionService>(
    "projection.current-subagents",
  );
export const KERNEL_OPERATOR_DECISIONS =
  createKernelServiceKey<OperatorDecisionsProjectionService>(
    "projection.current-approvals",
  );

export class AgentKernel {
  constructor(
    readonly profile: ResolvedKernelProfile,
    readonly services: KernelServiceRegistry,
    readonly hooks: KernelHookRegistry,
    readonly plugins: KernelPluginRegistry,
    readonly modelCalls: ComposableAgentModelCallPipeline,
    private readonly completionControl: KernelCompletionControlObserver,
    readonly threadSummaries: ThreadSummaryProjectionService,
    readonly taskNarratives: TaskNarrativeProjectionService,
    readonly activePlans: ActivePlanProjectionService,
    readonly conversationMessages: ConversationMessagesProjectionService,
    readonly conversationArtifacts: Pick<
      ConversationArtifactsProjectionService,
      "project"
    >,
    readonly conversationActivityEvents: ConversationActivityEventsProjectionService,
    readonly conversationActivityCandidates: ConversationActivityCandidatesProjectionService,
    readonly conversationPlans: ConversationPlansProjectionService,
    readonly conversationCitations: ConversationCitationsProjectionService,
    readonly conversationRecoveries: ConversationRecoveriesProjectionService,
    readonly conversationSubagents: ConversationSubagentsProjectionService,
    readonly operatorDecisions: OperatorDecisionsProjectionService,
  ) {}

  async runPrompt(options: RunPromptOptions): Promise<RunRecord> {
    const runtime = await this.services.resolve(KERNEL_AGENT_RUNTIME);
    return runtime.runPrompt({
      ...options,
      onEvent: composeEventSink(this.hooks, options.onEvent),
    });
  }

  async resumeInterruptedRun(
    options: ResumeInterruptedRunOptions,
  ): Promise<RunRecord> {
    const runtime = await this.services.resolve(KERNEL_AGENT_RUNTIME);
    return runtime.resumeInterruptedRun({
      ...options,
      onEvent: composeEventSink(this.hooks, options.onEvent),
    });
  }

  async continueOperatorDecision(
    options: ContinueOperatorDecisionOptions,
  ): Promise<RunRecord> {
    const runtime = await this.services.resolve(KERNEL_AGENT_RUNTIME);
    return runtime.continueOperatorDecision({
      ...options,
      onEvent: composeEventSink(this.hooks, options.onEvent),
    });
  }

  async resumeInterruptedRunAutomatically(
    options: ResumeInterruptedRunAutomaticallyOptions,
  ): Promise<RunRecord> {
    const runtime = await this.services.resolve(KERNEL_AGENT_RUNTIME);
    return runtime.resumeInterruptedRunAutomatically({
      ...options,
      onEvent: composeEventSink(this.hooks, options.onEvent),
    });
  }

  stop(threadId: string): boolean {
    return this.services.require(KERNEL_AGENT_RUNTIME).stop(threadId);
  }

  get modelRegistry(): ModelRegistry {
    return this.services.require(KERNEL_MODEL_ADAPTER).registry;
  }

  get toolInvocationResultCapsules() {
    return this.services.require(KERNEL_AGENT_RUNTIME)
      .toolInvocationResultCapsules;
  }

  inspect(): AgentKernelInspection {
    return {
      profile: this.profile,
      plugins: this.plugins.inspect(),
      services: this.services.inspect(),
      hooks: this.hooks.inspect(),
      modelCalls: this.modelCalls.inspect(),
      completionControl: this.completionControl.inspect(),
    };
  }

  scope(owner: string): AgentKernelScope {
    return new AgentKernelScope(
      this.services,
      this.hooks,
      this.modelCalls,
      owner,
    );
  }

  async shutdown(): Promise<void> {
    await this.plugins.shutdown();
    await this.services.shutdown();
    this.hooks.shutdown();
  }
}

export async function createAgentKernel(input: {
  profile: KernelProfileId;
  runtime: AgentRuntime;
  models: ModelRegistry;
  search?: KernelBuiltinSearchInput;
  browser?: KernelBuiltinBrowserInput;
}): Promise<AgentKernel> {
  const profile = resolveKernelProfile(input.profile);
  const services = new KernelServiceRegistry();
  const hooks = new KernelHookRegistry();
  const modelCalls = new ComposableAgentModelCallPipeline();
  installBuiltinModelCallExtensions(modelCalls, input.runtime.store);
  const plugins = new KernelPluginRegistry(
    (owner) => new AgentKernelScope(services, hooks, modelCalls, owner),
  );
  const completionControl = new KernelCompletionControlObserver();
  let runtimePipelineDetach: (() => void) | undefined;
  services.register({
    key: KERNEL_PROFILE,
    create: () => profile,
  });
  services.register({
    key: KERNEL_OPERATOR_DECISIONS,
    dependencies: [KERNEL_PROJECTION_REGISTRY, KERNEL_AGENT_RUNTIME],
    create: (resolver) =>
      new OperatorDecisionsProjectionService(
        resolver.require(KERNEL_PROJECTION_REGISTRY),
        input.runtime.store,
      ),
  });
  services.register({
    key: KERNEL_CONVERSATION_PLANS,
    dependencies: [KERNEL_PROJECTION_REGISTRY, KERNEL_AGENT_RUNTIME],
    create: (resolver) =>
      new ConversationPlansProjectionService(
        resolver.require(KERNEL_PROJECTION_REGISTRY),
        input.runtime.store,
      ),
  });
  services.register({
    key: KERNEL_CONVERSATION_ACTIVITY_CANDIDATES,
    dependencies: [KERNEL_PROJECTION_REGISTRY, KERNEL_AGENT_RUNTIME],
    create: (resolver) =>
      new ConversationActivityCandidatesProjectionService(
        resolver.require(KERNEL_PROJECTION_REGISTRY),
        input.runtime.store,
      ),
  });
  services.register({
    key: KERNEL_CONVERSATION_SUBAGENTS,
    dependencies: [KERNEL_PROJECTION_REGISTRY, KERNEL_AGENT_RUNTIME],
    create: (resolver) =>
      new ConversationSubagentsProjectionService(
        resolver.require(KERNEL_PROJECTION_REGISTRY),
        input.runtime.store,
      ),
  });
  services.register({
    key: KERNEL_CONVERSATION_RECOVERIES,
    dependencies: [KERNEL_PROJECTION_REGISTRY, KERNEL_AGENT_RUNTIME],
    create: (resolver) =>
      new ConversationRecoveriesProjectionService(
        resolver.require(KERNEL_PROJECTION_REGISTRY),
        input.runtime.store,
      ),
  });
  services.register({
    key: KERNEL_CONVERSATION_CITATIONS,
    dependencies: [KERNEL_PROJECTION_REGISTRY, KERNEL_AGENT_RUNTIME],
    create: (resolver) =>
      new ConversationCitationsProjectionService(
        resolver.require(KERNEL_PROJECTION_REGISTRY),
        input.runtime.store,
      ),
  });
  services.register({
    key: KERNEL_CONVERSATION_ACTIVITY_EVENTS,
    dependencies: [KERNEL_PROJECTION_REGISTRY, KERNEL_AGENT_RUNTIME],
    create: (resolver) =>
      new ConversationActivityEventsProjectionService(
        resolver.require(KERNEL_PROJECTION_REGISTRY),
        input.runtime.store,
      ),
  });
  services.register({
    key: KERNEL_CONVERSATION_MESSAGES,
    dependencies: [KERNEL_PROJECTION_REGISTRY, KERNEL_AGENT_RUNTIME],
    create: (resolver) =>
      new ConversationMessagesProjectionService(
        resolver.require(KERNEL_PROJECTION_REGISTRY),
        input.runtime.store,
      ),
  });
  services.register({
    key: KERNEL_ACTIVE_PLANS,
    dependencies: [KERNEL_PROJECTION_REGISTRY, KERNEL_AGENT_RUNTIME],
    create: (resolver) =>
      new ActivePlanProjectionService(
        resolver.require(KERNEL_PROJECTION_REGISTRY),
        input.runtime.store,
      ),
  });
  services.register({
    key: KERNEL_TASK_NARRATIVES,
    dependencies: [KERNEL_PROJECTION_REGISTRY, KERNEL_AGENT_RUNTIME],
    create: (resolver) =>
      new TaskNarrativeProjectionService(
        resolver.require(KERNEL_PROJECTION_REGISTRY),
        input.runtime.store,
      ),
  });
  services.register({
    key: KERNEL_MODEL_CALL_PIPELINE,
    dependencies: [KERNEL_PROFILE],
    create: () => modelCalls,
    dispose: (pipeline) => pipeline.shutdown(),
  });
  services.register({
    key: KERNEL_MODEL_ADAPTER,
    dependencies: [KERNEL_PROFILE, KERNEL_MODEL_CALL_PIPELINE],
    create: (resolver) => ({
      registry: input.models,
      pipeline: resolver.require(KERNEL_MODEL_CALL_PIPELINE),
    }),
  });
  services.register({
    key: KERNEL_PROMPT_ADAPTER,
    dependencies: [KERNEL_PROFILE],
    create: () => ({ create: createAgentPromptBuilder }),
  });
  services.register({
    key: KERNEL_TOOL_ADAPTER,
    dependencies: [KERNEL_PROFILE],
    create: () => ({ createWorkspaceTools }),
  });
  services.register({
    key: KERNEL_POLICY_ADAPTER,
    dependencies: [KERNEL_PROFILE],
    create: () => ({ preflight: preflightAgentToolPolicy }),
  });
  services.register({
    key: KERNEL_COMPLETION_CONTROL,
    dependencies: [KERNEL_PROFILE],
    create: () => {
      completionControl.attach(hooks);
      return completionControl;
    },
    dispose: (observer) => observer.dispose(),
  });
  services.register({
    key: KERNEL_PROJECTION_REGISTRY,
    dependencies: [KERNEL_PROFILE],
    create: () => new KernelProjectionRegistry(),
    dispose: (registry) => registry.shutdown(),
  });
  services.register({
    key: KERNEL_THREAD_SUMMARIES,
    dependencies: [KERNEL_PROJECTION_REGISTRY, KERNEL_AGENT_RUNTIME],
    create: (resolver) =>
      new ThreadSummaryProjectionService(
        resolver.require(KERNEL_PROJECTION_REGISTRY),
        input.runtime.store,
      ),
  });
  services.register({
    key: KERNEL_AGENT_RUNTIME,
    dependencies: [
      KERNEL_MODEL_CALL_PIPELINE,
      KERNEL_MODEL_ADAPTER,
      KERNEL_PROMPT_ADAPTER,
      KERNEL_TOOL_ADAPTER,
      KERNEL_POLICY_ADAPTER,
      KERNEL_COMPLETION_CONTROL,
    ],
    create: (resolver) => {
      const detach = input.runtime.attachKernelModelCallPipeline(
        resolver.require(KERNEL_MODEL_CALL_PIPELINE),
      );
      runtimePipelineDetach = detach;
      return input.runtime;
    },
    dispose: () => {
      runtimePipelineDetach?.();
      runtimePipelineDetach = undefined;
    },
  });
  await installBuiltinKernelPlugins({
    plugins,
    artifact: {
      serviceKey: KERNEL_CONVERSATION_ARTIFACTS,
      projectionRegistryKey: KERNEL_PROJECTION_REGISTRY,
      runtimeKey: KERNEL_AGENT_RUNTIME,
      store: input.runtime.store,
    },
    ...(input.search ? { search: input.search } : {}),
    ...(input.browser ? { browser: input.browser } : {}),
  });
  await services.resolve(KERNEL_AGENT_RUNTIME);
  await services.resolve(KERNEL_MODEL_CALL_PIPELINE);
  const threadSummaries = await services.resolve(KERNEL_THREAD_SUMMARIES);
  const taskNarratives = await services.resolve(KERNEL_TASK_NARRATIVES);
  const activePlans = await services.resolve(KERNEL_ACTIVE_PLANS);
  const conversationMessages = await services.resolve(
    KERNEL_CONVERSATION_MESSAGES,
  );
  const conversationArtifacts = {
    project: async (threadId: string) =>
      (await services.resolve(KERNEL_CONVERSATION_ARTIFACTS)).project(threadId),
  };
  const conversationActivityEvents = await services.resolve(
    KERNEL_CONVERSATION_ACTIVITY_EVENTS,
  );
  const conversationActivityCandidates = await services.resolve(
    KERNEL_CONVERSATION_ACTIVITY_CANDIDATES,
  );
  const conversationPlans = await services.resolve(KERNEL_CONVERSATION_PLANS);
  const conversationCitations = await services.resolve(
    KERNEL_CONVERSATION_CITATIONS,
  );
  const conversationRecoveries = await services.resolve(
    KERNEL_CONVERSATION_RECOVERIES,
  );
  const conversationSubagents = await services.resolve(
    KERNEL_CONVERSATION_SUBAGENTS,
  );
  const operatorDecisions = await services.resolve(KERNEL_OPERATOR_DECISIONS);
  return new AgentKernel(
    profile,
    services,
    hooks,
    plugins,
    modelCalls,
    completionControl,
    threadSummaries,
    taskNarratives,
    activePlans,
    conversationMessages,
    conversationArtifacts,
    conversationActivityEvents,
    conversationActivityCandidates,
    conversationPlans,
    conversationCitations,
    conversationRecoveries,
    conversationSubagents,
    operatorDecisions,
  );
}
