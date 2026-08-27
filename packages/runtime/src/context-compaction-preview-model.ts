import {
  contentText,
  type Api,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { RunEvent, RunRecord, Usage } from "@napier/contracts";

import { modelRefFromModel, mapModelUsage } from "./agent-model-projection.js";
import { compileAuxiliaryPrompt } from "./agent-prompt-layers.js";
import {
  buildContextCompactionMessages,
  parseContextCompactionResponse,
} from "./compaction.js";
import { sha256 } from "./ed25519.js";
import { captureCompiledModelInvocation } from "./model-invocation-capture.js";
import type { ModelInvocationCapsuleStore } from "./model-invocation-capsule-store.js";
import { modelAdapterReceipt } from "./model-adapters.js";
import type { ModelRegistry } from "./models.js";
import type { LocalStore } from "./store.js";
import { createUsageAccounting } from "./token-accounting.js";

export async function invokeContextCompactionPreviewModel(input: {
  store: LocalStore;
  models: ModelRegistry;
  capsules: ModelInvocationCapsuleStore;
  run: RunRecord;
  model: Model<Api>;
  messages: RunEvent[];
  continuity: RunEvent[];
  signal?: AbortSignal;
}): Promise<{
  compaction: ReturnType<typeof parseContextCompactionResponse>;
  usage: Usage;
}> {
  const prompt = buildContextCompactionMessages(
    undefined,
    input.messages,
    input.continuity,
  );
  const options = {
    ...(input.signal ? { signal: input.signal } : {}),
    maxTokens: 1_200,
    temperature: 0,
  } satisfies SimpleStreamOptions;
  const captured = await captureCompiledModelInvocation({
    store: input.store,
    capsules: input.capsules,
    run: input.run,
    model: input.model,
    context: {
      systemPrompt: prompt.system,
      messages: [{ role: "user", content: prompt.user, timestamp: Date.now() }],
      tools: [],
    },
    options,
    turnIndex: 0,
    purpose: "context_compaction",
    compiledPrompt: compileAuxiliaryPrompt({
      purpose: "context_compaction",
      sourceId: "task.context_compaction",
      systemPrompt: prompt.system,
      adapter: modelAdapterReceipt(input.model, options),
    }),
  });
  let response;
  try {
    response = await input.models.models.completeSimple(
      input.model,
      captured.context,
      options,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await input.store.appendEvent({
      threadId: input.run.threadId,
      runId: input.run.id,
      type: "model.response",
      category: "model",
      visibility: "debug",
      payload: {
        modelCallPurpose: "context_compaction",
        errorSha256: sha256(message),
        errorBytes: Buffer.byteLength(message, "utf8"),
        contentRedacted: true,
        model: `${input.model.provider}/${input.model.id}`,
        stopReason: "error",
        modelContextEnvelopeSha256: captured.envelope.contentSha256,
        modelContextEnvelopeTurnIndex: captured.envelope.turnIndex,
        modelContextMessageSetSha256: captured.envelope.messageSetSha256,
        modelContextToolDefinitionSetSha256:
          captured.envelope.toolDefinitionSetSha256,
      },
      admission: "run_active",
    });
    throw error;
  }
  const responseText = contentText(response.content);
  const usage = mapModelUsage(response.usage);
  await input.store.appendEvent({
    threadId: input.run.threadId,
    runId: input.run.id,
    type: "model.response",
    category: "model",
    visibility: "debug",
    payload: {
      modelCallPurpose: "context_compaction",
      textSha256: sha256(responseText),
      textBytes: Buffer.byteLength(responseText, "utf8"),
      contentRedacted: true,
      model: `${input.model.provider}/${input.model.id}`,
      ...(response.stopReason ? { stopReason: response.stopReason } : {}),
      modelContextEnvelopeSha256: captured.envelope.contentSha256,
      modelContextEnvelopeTurnIndex: captured.envelope.turnIndex,
      modelContextMessageSetSha256: captured.envelope.messageSetSha256,
      modelContextToolDefinitionSetSha256:
        captured.envelope.toolDefinitionSetSha256,
      usage,
      usageAccounting: createUsageAccounting(
        modelRefFromModel(input.model),
        usage,
      ),
    },
    admission: "run_active",
  });
  return {
    compaction: parseContextCompactionResponse(responseText),
    usage,
  };
}
