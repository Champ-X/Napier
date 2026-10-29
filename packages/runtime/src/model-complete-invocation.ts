import type { Api, AssistantMessage, Context, Model, Models, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ModelAccountingPhase, ModelCallAttributionV1, ModelCallCaptureBinding } from "@napier/contracts/model-accounting";
import { bindModelResultAttribution } from "./model-call-attribution.js";
import { dispatchAccountedModelInvocation, type ModelInvocationAccounting } from "./model-call-accounting-driver.js";
import { createModelCallCaptureBinding } from "./model-call-capture.js";
import { createModelContextEnvelopeReceipt } from "./model-context-envelope.js";
import { snapshotModelInvocation } from "./model-invocation-snapshot.js";
import { attestHostModelAbort } from "./model-abort-provenance.js";

export async function completeModelInvocation(input: {
  models: Pick<Models, "completeSimple">;
  model: Model<Api>;
  context: Context;
  options?: SimpleStreamOptions;
  phase: ModelAccountingPhase;
  accounting?: ModelInvocationAccounting | undefined;
  capture?: ModelCallCaptureBinding;
  onAttribution?(attribution: ModelCallAttributionV1): void;
}): Promise<AssistantMessage> {
  if (!input.accounting) return input.models.completeSimple(input.model, input.context, input.options);
  const request = snapshotModelInvocation({ ...input, options: input.options });
  const capture = input.capture ?? createModelCallCaptureBinding({
    ...request, ...(request.options ? { options: request.options } : {}),
    envelope: createModelContextEnvelopeReceipt({ turnIndex: 0, systemPrompt: request.context.systemPrompt ?? "",
      messages: request.context.messages, tools: request.context.tools ?? [] }),
  });
  const dispatched = await dispatchAccountedModelInvocation({
    accounting: input.accounting, models: input.models, method: "completeSimple", phase: input.phase,
    model: request.model, capture,
    ...(input.onAttribution ? { onAttribution: input.onAttribution } : {}),
    invoke: () => input.models.completeSimple(request.model, request.context, request.options),
  });
  const response = dispatched.value;
  const signal = request.options?.signal;
  if (!signal) return response;
  let abort: (() => void) | undefined;
  const interrupted = new Promise<AssistantMessage>((resolve) => {
    abort = () => resolve(bindModelResultAttribution(attestHostModelAbort({
      role: "assistant", content: [], api: request.model.api, provider: request.model.provider,
      model: request.model.id, stopReason: "aborted", errorMessage: "Model call was aborted by its owner.", timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    }, { owner: "caller" }), dispatched.attribution));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([response, interrupted]); }
  finally { if (abort) signal.removeEventListener("abort", abort); }
}
