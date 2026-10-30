import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { EventSink } from "./event-sink.js";
import type { SubagentModelCallScope } from "./subagent-model-call-services.js";
import { compactSubagentContext, createSubagentContextCompactor } from "./subagent-context-compaction.js";
import { prepareCompiledModelInvocation } from "./model-call-compiled-preparation.js";
import { prepareHarnessModelCallBudget } from "./harness-model-call-budget.js";
import { bindRunBudgetContext } from "./run-budget-context.js";
import { stripRuntimeContext } from "./runtime-context-delivery.js";
import type { CompiledPromptArtifact } from "./prompt-compiler.js";
export type { SubagentModelCallScope } from "./subagent-model-call-services.js";

/** Request-local preparation; neither SDK state nor the child lease is replaced. */
export async function prepareSubagentModelInvocation(input: {
  scope?: SubagentModelCallScope;
  compaction: Parameters<typeof createSubagentContextCompactor>[0];
  model: Model<Api>;
  context: Context;
  options: SimpleStreamOptions;
  signal: AbortSignal;
  modelAttempt: number;
  recoveryAttempt: 0 | 1;
  onEvent?: EventSink;
}): Promise<{ context: Context; options: SimpleStreamOptions; compiledPrompt?: CompiledPromptArtifact }> {
  if (!input.scope) return {
    context: await compactSubagentContext({ ...input.compaction, model: input.model,
      context: input.context, options: input.options, modelAttempt: input.modelAttempt, recoveryAttempt: input.recoveryAttempt }),
    options: input.options,
  };
  const scope = input.scope;
  const run = input.compaction.child.run;
  const call = { run, attempt: input.modelAttempt, model: input.model,
    context: stripRuntimeContext(run, input.context), options: { ...input.options, signal: input.signal },
    ...(scope.harnessExperimentProfile ? { harnessExperimentProfile: scope.harnessExperimentProfile } : {}),
    ...(input.onEvent ? { onEvent: input.onEvent } : {}),
  };
  const prepared = await scope.lifecycle.prepare(call);
  const budget = input.compaction.child.createBudget();
  const policy = scope.harnessExperimentProfile?.policies;
  const options = prepareHarnessModelCallBudget(input.model, prepared.options, policy?.modelCall);
  const context = await scope.prepareInvocationContext({ context: prepared.context, policy: policy?.context, budget });
  return prepareCompiledModelInvocation({
    call: { ...call, context, options }, buildCompiledPrompt: scope.buildCompiledPrompt,
    finalize: scope.lifecycle.finalize, recoveryAttempt: input.recoveryAttempt,
    runContextCompaction: createSubagentContextCompactor({ ...input.compaction, budget }),
    ...(policy?.context.finalization === "request-aware-v2"
      ? { refreshBudgetContext: (context: Context) => bindRunBudgetContext(context, budget) } : {}),
  });
}
