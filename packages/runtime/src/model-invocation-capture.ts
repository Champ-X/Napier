import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type {
  ModelContextEnvelopeReceipt,
  ModelInvocationPurpose,
  RunRecord,
} from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import { sha256 } from "./ed25519.js";
import {
  COMPILED_PROMPT_PACKAGE_EVENT,
  createCompiledPromptPackageReceipt,
} from "./compiled-prompt-package.js";
import {
  applyModelAdapterOptions,
  modelAdapterReceipt,
} from "./model-adapters.js";
import type { ModelInvocationCapsuleStore } from "./model-invocation-capsule-store.js";
import type { LocalStore } from "./store.js";

export async function captureModelInvocation(
  store: LocalStore,
  capsules: ModelInvocationCapsuleStore,
  run: RunRecord,
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  envelope: ModelContextEnvelopeReceipt,
  purpose: ModelInvocationPurpose,
  onEvent?: EventSink,
): Promise<void> {
  try {
    const adaptedOptions = applyModelAdapterOptions(model, options);
    const adapter = modelAdapterReceipt(model, options);
    await append(
      store,
      {
        threadId: run.threadId,
        runId: run.id,
        type: "context.model_adapter",
        category: "model",
        visibility: "debug",
        payload: JSON.parse(JSON.stringify(adapter)),
      },
      onEvent,
    );
    const promptPackage = createCompiledPromptPackageReceipt({
      systemPrompt: context.systemPrompt ?? "",
      envelope,
      adapter,
      purpose,
    });
    await append(
      store,
      {
        threadId: run.threadId,
        runId: run.id,
        type: COMPILED_PROMPT_PACKAGE_EVENT,
        category: "model",
        visibility: "debug",
        payload: JSON.parse(JSON.stringify(promptPackage)),
      },
      onEvent,
    );
    const receipt = await capsules.put({
      sourceThreadId: run.threadId,
      sourceRunId: run.id,
      turnIndex: envelope.turnIndex,
      purpose,
      model,
      contextEnvelopeSha256: envelope.contentSha256,
      context,
      ...(adaptedOptions ? { options: adaptedOptions } : {}),
    });
    await append(
      store,
      {
        threadId: run.threadId,
        runId: run.id,
        type: "context.model_invocation",
        category: "model",
        visibility: "debug",
        payload: JSON.parse(JSON.stringify(receipt)),
      },
      onEvent,
    );
  } catch (error) {
    await append(
      store,
      {
        threadId: run.threadId,
        runId: run.id,
        type: "context.model_invocation_unavailable",
        category: "model",
        visibility: "debug",
        payload: {
          schemaVersion: 1,
          turnIndex: envelope.turnIndex,
          purpose,
          model: `${model.provider}/${model.id}`,
          contextEnvelopeSha256: envelope.contentSha256,
          reason: captureFailureReason(error),
          diagnosticSha256: sha256(errorMessage(error)),
        },
      },
      onEvent,
    );
  }
}

async function append(
  store: LocalStore,
  input: Parameters<LocalStore["appendEvent"]>[0],
  onEvent?: EventSink,
): Promise<void> {
  const event = await store.appendEvent(input);
  if (!onEvent) return;
  try {
    await onEvent(event);
  } catch {
    // A disconnected observer must not cancel durable Agent execution.
  }
}

function captureFailureReason(error: unknown): "limit" | "storage" | "invalid" {
  const message = errorMessage(error);
  if (/\b(?:byte|count|limit|exceeds)\b/iu.test(message)) return "limit";
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    ["EACCES", "EDQUOT", "ENOSPC", "EROFS"].includes(String(error.code))
  ) {
    return "storage";
  }
  return "invalid";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
