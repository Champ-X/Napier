import { contentText, type Api, type AssistantMessage, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { RunRecord } from "@napier/contracts";
import type { ModelCallAttributionV1 } from "@napier/contracts/model-accounting";
import { compileAuxiliaryPrompt } from "./agent-prompt-layers.js";
import { modelAdapterReceipt } from "./model-adapter-receipt.js";
import { captureCompiledModelInvocation } from "./model-invocation-capture.js";
import { completeModelInvocation } from "./model-complete-invocation.js";
import { modelAccountingLinkage } from "./model-call-attribution.js";
import { sha256 } from "./ed25519.js";
import type { ModelInvocationCapsuleStore } from "./model-invocation-capsule-store.js";
import type { ModelRegistry } from "./models.js";
import type { LocalStore } from "./store.js";
import type { EventSink } from "./event-sink.js";

/** Auxiliary callers share exact capture, native dispatch and logical evidence. */
export async function requestRunAuxiliaryModel(input: {
  store: Pick<LocalStore, "appendEvent">;
  models: ModelRegistry;
  capsules: ModelInvocationCapsuleStore;
  run: RunRecord;
  model: Model<Api>;
  prompt: { system: string; user: string };
  options: SimpleStreamOptions;
  turnIndex: number;
  phase: "context_compaction" | "goal_evaluation" | "memory_extraction";
  onAttribution?(attribution: ModelCallAttributionV1): void;
  onEvent?: EventSink | undefined;
}): Promise<AssistantMessage> {
  const prepared = await captureCompiledModelInvocation({
    store: input.store, capsules: input.capsules, run: input.run, model: input.model,
    context: { systemPrompt: input.prompt.system, messages: [{ role: "user", content: input.prompt.user, timestamp: Date.now() }], tools: [] },
    options: input.options, turnIndex: input.turnIndex, purpose: input.phase,
    compiledPrompt: compileAuxiliaryPrompt({ purpose: input.phase, sourceId: `task.${input.phase}`,
      systemPrompt: input.prompt.system, adapter: modelAdapterReceipt(input.model, input.options) }),
    ...(input.onEvent ? { onEvent: input.onEvent } : {}),
  });
  let attribution: ModelCallAttributionV1 | undefined;
  const record = async (text: string, stopReason: string, failed: boolean) => {
    const envelope = prepared.envelope;
    const event = await input.store.appendEvent({ threadId: input.run.threadId, runId: input.run.id,
      type: "model.response", category: "model", visibility: "debug", payload: {
        modelCallPurpose: input.phase, ...(attribution ? modelAccountingLinkage(attribution) : {}),
        ...(failed ? { errorSha256: sha256(text), errorBytes: Buffer.byteLength(text, "utf8") }
          : { textSha256: sha256(text), textBytes: Buffer.byteLength(text, "utf8") }),
        contentRedacted: true, model: `${input.model.provider}/${input.model.id}`, stopReason,
        modelContextEnvelopeSha256: envelope.contentSha256, modelContextEnvelopeTurnIndex: envelope.turnIndex,
        modelContextMessageSetSha256: envelope.messageSetSha256, modelContextToolDefinitionSetSha256: envelope.toolDefinitionSetSha256,
      } });
    try { await input.onEvent?.(event); } catch { /* Durable evidence survives stream disconnects. */ }
  };
  let response: AssistantMessage;
  try {
    response = await completeModelInvocation({ models: input.models.models, model: input.model,
      context: prepared.context, options: input.options, phase: input.phase,
      accounting: input.models.accountingForRun(input.run.id), capture: prepared.accountingCapture,
      onAttribution: (value) => { attribution = value; input.onAttribution?.(value); },
    });
  } catch (error) {
    await record(error instanceof Error ? error.message : String(error), "error", true);
    throw error;
  }
  await record(contentText(response.content), response.stopReason, false);
  return response;
}
