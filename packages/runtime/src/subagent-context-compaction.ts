import type { Api, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ModelContextEnvelopeReceipt } from "@napier/contracts";
import type { EventSink } from "./event-sink.js";
import type { ModelSessionLifetime } from "./model-session.js";
import { RunContextCompactor } from "./run-context-compaction.js";
import type { RunCompactionHost, RunCompactionInvocationInput } from "./run-context-compaction-model.js";
import type { SubagentChildExecution } from "./subagent-child-execution.js";
import { subagentModelDenial } from "./subagent-model-turn-denial.js";
import { TokenMeterRegistry } from "./token-meter-provider.js";

/** Request-local projection only: the Agent and private checkpoint keep raw messages. */
export async function compactSubagentContext(input: {
  host: RunCompactionHost;
  child: SubagentChildExecution;
  session: {
    lifetime: ModelSessionLifetime;
    open(phase: "context_compaction", model: Model<Api>, context: Context, options: SimpleStreamOptions,
      hooks: { responseEvidence: RunCompactionInvocationInput["responseEvidence"];
        onCaptured(envelope: ModelContextEnvelopeReceipt): void }): Promise<AssistantMessageEventStream>;
  };
  model: Model<Api>;
  context: Context;
  options: SimpleStreamOptions;
  modelAttempt: number;
  onEvent?: EventSink;
}): Promise<Context> {
  const run = input.child.run;
  // Independent local tracker includes inherited admission debt, never new usage.
  const budget = input.child.createBudget();
  const compactor = new RunContextCompactor(input.host, run, budget, () => 0, input.onEvent, {
    invoke: async ({ model, request, responseEvidence }) => {
      let envelopeSha256: string | undefined;
      const stream = await input.session.open("context_compaction", model,
        { ...request.context, systemPrompt: request.compiledPrompt.systemPrompt }, request.options, {
        responseEvidence,
        onCaptured: (envelope) => { envelopeSha256 = envelope.contentSha256; },
      });
      // ModelSession settles its terminal by consuming the cancellable stream.
      for await (const _event of stream) { /* Drain before awaiting result. */ }
      const response = await stream.result();
      const denial = subagentModelDenial(response);
      if (denial) throw denial;
      if (!envelopeSha256) throw new Error("Child compaction has no captured context envelope");
      return { response, envelopeSha256 };
    },
  });
  const projected = await compactor.project({
    sourceContext: input.context,
    prunedContext: input.context,
    context: input.context,
    model: input.model,
    options: { ...input.options, signal: AbortSignal.any(
      [input.session.lifetime.signal, input.options.signal].filter((signal): signal is AbortSignal => Boolean(signal)),
    ) },
    // Measurement is exact role text; it is not a full compiler acceptance claim.
    compiledPrompt: { systemPrompt: input.context.systemPrompt ?? "" },
    tokenMeters: new TokenMeterRegistry(),
    modelAttempt: input.modelAttempt,
    recoveryAttempt: 0,
  });
  input.session.lifetime.assertActive();
  return projected.context;
}
