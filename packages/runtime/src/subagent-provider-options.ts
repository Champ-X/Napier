import type { SubagentModelCallServices } from "./subagent-model-call-services.js";
import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import type { AgentProfile, RunRecord, SubagentLimits } from "@napier/contracts";
import type { EventSink } from "./event-sink.js";
import type { ModelRouter } from "./model-route.js";
import type { LocalStore } from "./store.js";
import type { ToolConcurrencyGate } from "./tool-concurrency-gate.js";
import type { SubagentWorktreeMutationManager } from "./subagent-worktree-mutation.js";
import type { SubagentExecutionCleanup, SubagentInheritedToolsFactory } from "./subagent-execution-context.js";

export type SubagentModelRouteSession = Awaited<ReturnType<ModelRouter["createSession"]>>;

export interface SubagentProviderOptions {
  modelCallServices?: SubagentModelCallServices;
  store: LocalStore;
  models: MutableModels;
  modelRouter?: ModelRouter;
  defaultModel: Model<Api>;
  profile: AgentProfile;
  run: RunRecord;
  limits: SubagentLimits;
  parentSignal: AbortSignal;
  concurrencyGate: ToolConcurrencyGate;
  worktrees?: SubagentWorktreeMutationManager;
  createInheritedTools?: SubagentInheritedToolsFactory;
  cleanupExecutionResources?: SubagentExecutionCleanup;
  schedule?<T>(operation: () => Promise<T>): Promise<T>;
  onEvent?: EventSink;
}
