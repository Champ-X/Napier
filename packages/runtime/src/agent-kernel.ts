import type { RunEvent, RunRecord } from "@napier/contracts";
import type { KernelPluginInspection } from "@napier/contracts/kernel-plugins";

import { createAgentPromptBuilder } from "./agent-prompt-builder.js";
import type { RunPromptOptions } from "./agent-runtime-options.js";
import type { AgentRuntime } from "./agent-runtime.js";
import { AgentKernelScope } from "./agent-kernel-scope.js";
import type { EventSink } from "./event-sink.js";
import { KernelHookRegistry, type KernelHookName } from "./kernel-hooks.js";
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

export interface KernelModelAdapter {
  registry: ModelRegistry;
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

export interface KernelCompletionControlProjection {
  total: number;
  counts: Record<string, number>;
  latest?: { type: string; runId: string; seq: number };
}

export interface AgentKernelInspection {
  profile: ResolvedKernelProfile;
  plugins: KernelPluginInspection[];
  services: KernelServiceInspection[];
  hooks: Array<{ name: KernelHookName; owners: string[]; count: number }>;
  completionControl: KernelCompletionControlProjection;
}

export const KERNEL_PROFILE =
  createKernelServiceKey<ResolvedKernelProfile>("kernel.profile");
export const KERNEL_AGENT_RUNTIME =
  createKernelServiceKey<AgentRuntime>("runtime.agent");
export const KERNEL_MODEL_ADAPTER =
  createKernelServiceKey<KernelModelAdapter>("runtime.model");
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

  inspect(): AgentKernelInspection {
    return {
      profile: this.profile,
      plugins: this.plugins.inspect(),
      services: this.services.inspect(),
      hooks: this.hooks.inspect(),
      completionControl: this.completionControl.inspect(),
    };
  }

  scope(owner: string): AgentKernelScope {
    return new AgentKernelScope(this.services, this.hooks, owner);
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
  const plugins = new KernelPluginRegistry(
    (owner) => new AgentKernelScope(services, hooks, owner),
  );
  const completionControl = new KernelCompletionControlObserver();
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
    key: KERNEL_MODEL_ADAPTER,
    dependencies: [KERNEL_PROFILE],
    create: () => ({ registry: input.models }),
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
      KERNEL_MODEL_ADAPTER,
      KERNEL_PROMPT_ADAPTER,
      KERNEL_TOOL_ADAPTER,
      KERNEL_POLICY_ADAPTER,
      KERNEL_COMPLETION_CONTROL,
    ],
    create: () => input.runtime,
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

class KernelCompletionControlObserver {
  private readonly counts = new Map<string, number>();
  private latest: KernelCompletionControlProjection["latest"];
  private unsubscribe: (() => void) | undefined;

  attach(hooks: KernelHookRegistry): void {
    this.unsubscribe = hooks.on(
      "completion.control",
      ({ control, event, runId }) => {
        this.counts.set(control, (this.counts.get(control) ?? 0) + 1);
        this.latest = { type: control, runId, seq: event.seq };
      },
      "kernel.completion-control",
    );
  }

  inspect(): KernelCompletionControlProjection {
    return {
      total: [...this.counts.values()].reduce(
        (total, count) => total + count,
        0,
      ),
      counts: Object.fromEntries(
        [...this.counts].sort(([left], [right]) => left.localeCompare(right)),
      ),
      ...(this.latest ? { latest: { ...this.latest } } : {}),
    };
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}

function composeEventSink(
  hooks: KernelHookRegistry,
  sink: EventSink | undefined,
): EventSink {
  return async (event: RunEvent) => {
    await hooks.observe(event);
    await sink?.(event);
  };
}
