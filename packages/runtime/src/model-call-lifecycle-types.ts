import type { Api, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ModelContextEnvelopeReceipt, RunRecord } from "@napier/contracts";
import type { EventSink } from "./event-sink.js";
import type { ModelHarnessExperimentProfile } from "./model-harness-experiment-profile.js";
import type { CompiledPromptArtifact } from "./prompt-compiler.js";
import type { RunContextCompactionPort } from "./run-context-compaction-types.js";

export interface AgentModelCallPreparation {
  run: RunRecord;
  attempt: number;
  model: Model<Api>;
  context: Context;
  options: SimpleStreamOptions;
  harnessExperimentProfile?: ModelHarnessExperimentProfile | undefined;
  onEvent?: EventSink;
}

export interface PreparedAgentModelCall {
  context: Context;
  options: SimpleStreamOptions;
}

export interface AgentModelInvocation extends AgentModelCallPreparation {
  compiledPrompt: CompiledPromptArtifact;
  envelope: ModelContextEnvelopeReceipt;
}

export interface AgentModelCallFinalization extends AgentModelCallPreparation {
  compiledPrompt: CompiledPromptArtifact;
  recoveryAttempt: 0 | 1;
  runContextCompaction?: RunContextCompactionPort;
  refreshBudgetPrompt?: () => CompiledPromptArtifact;
}

export type CompiledModelPromptBuilder = (
  model: Model<Api>, options: SimpleStreamOptions | undefined, context: Context,
) => CompiledPromptArtifact;

/** The guarded extension boundary; execution ownership stays with its caller. */
export interface AgentModelCallLifecycle {
  prepare(call: AgentModelCallPreparation): Promise<PreparedAgentModelCall>;
  finalize(call: AgentModelCallFinalization): Promise<PreparedAgentModelCall>;
  invoke(call: AgentModelInvocation, next: () => AssistantMessageEventStream): AssistantMessageEventStream;
}
