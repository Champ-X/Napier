import type { Context } from "@earendil-works/pi-ai";
import type { AgentModelCallPreparation, AgentModelCallFinalization, PreparedAgentModelCall, CompiledModelPromptBuilder } from "./model-call-lifecycle-types.js";
import type { RunContextCompactionPort } from "./run-context-compaction-types.js";
import type { CompiledPromptArtifact } from "./prompt-compiler.js";
import { assertHarnessModelCallBudget } from "./harness-model-call-budget.js";
import { runtimeContextDelivery } from "./runtime-context-delivery.js";

/** Compile and finalize the physical request without taking ownership of its
 * session, reservation, accounting, durable transcript, or recovery loop. */
export async function prepareCompiledModelInvocation(input: {
  call: AgentModelCallPreparation;
  buildCompiledPrompt: CompiledModelPromptBuilder;
  finalize?: (call: AgentModelCallFinalization) => PreparedAgentModelCall | Promise<PreparedAgentModelCall>;
  recoveryAttempt: 0 | 1;
  runContextCompaction?: RunContextCompactionPort;
  refreshBudgetContext?: (context: Context) => void;
}): Promise<{ context: Context; options: AgentModelCallPreparation["options"]; compiledPrompt: CompiledPromptArtifact }> {
  const { call } = input;
  let compiledPrompt = input.buildCompiledPrompt(call.model, call.options, call.context);
  if (!input.finalize && runtimeContextDelivery(compiledPrompt))
    throw new Error("Runtime context delivery requires context projection finalization");
  const finalization: AgentModelCallFinalization = {
    ...call, options: { ...call.options }, compiledPrompt,
    recoveryAttempt: input.recoveryAttempt,
    ...(input.runContextCompaction ? { runContextCompaction: input.runContextCompaction } : {}),
    ...(input.refreshBudgetContext ? { refreshBudgetPrompt: () => {
      input.refreshBudgetContext!(call.context);
      compiledPrompt = input.buildCompiledPrompt(call.model, call.options, call.context);
      return compiledPrompt;
    } } : {}),
  };
  const finalized = input.finalize ? await input.finalize(finalization) : { context: call.context, options: call.options };
  assertHarnessModelCallBudget(call.model, call.options, finalized.options, call.harnessExperimentProfile?.policies?.modelCall);
  return { ...finalized, compiledPrompt };
}
