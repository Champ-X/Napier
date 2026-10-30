import { captureCompiledModelRequest } from "./model-invocation-compiled-request.js";
import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ModelContextEnvelopeReceipt, ModelInvocationPurpose, RunRecord } from "@napier/contracts";
import type { ModelCallCaptureBinding } from "@napier/contracts/model-accounting";

import type { EventSink } from "./event-sink.js";
import {
  COMPILED_PROMPT_PACKAGE_EVENT,
} from "./compiled-prompt-package.js";
import {
  type ExactModelInvocationCaptureEvent,
} from "./model-invocation-exact-capture.js";
import type { ModelInvocationCapsuleStore } from "./model-invocation-capsule-store.js";
import type { CompiledPromptArtifact } from "./prompt-compiler.js";
import type { LocalStore } from "./store.js";

type ModelInvocationCaptureStore = Pick<LocalStore, "appendEvent">;
const EVENT_TYPES = {
  envelope: "context.model_envelope",
  adapter: "context.model_adapter",
  invocation: "context.model_invocation",
  unavailable: "context.model_invocation_unavailable",
  cache_projection: "context.prompt_cache_projection",
} as const satisfies Record<ExactModelInvocationCaptureEvent["kind"], string>;

export async function captureCompiledModelInvocation(input: {
  store: ModelInvocationCaptureStore;
  capsules: ModelInvocationCapsuleStore;
  run: RunRecord;
  model: Model<Api>;
  context: Context;
  options: SimpleStreamOptions | undefined;
  turnIndex: number;
  purpose: ModelInvocationPurpose;
  compiledPrompt: CompiledPromptArtifact;
  cacheScope?: object;
  phase?: string;
  onEvent?: EventSink;
}): Promise<{ context: Context; envelope: ModelContextEnvelopeReceipt; accountingCapture: ModelCallCaptureBinding }> {
  const record = async (
    type: (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES] | typeof COMPILED_PROMPT_PACKAGE_EVENT,
    payload: object,
  ): Promise<void> => append(input.store, {
    threadId: input.run.threadId,
    runId: input.run.id,
    type,
    category: "model",
    visibility: "debug",
    payload: JSON.parse(JSON.stringify(payload)),
  }, input.onEvent);
  return captureCompiledModelRequest({
    capsules: input.capsules,
    source: { threadId: input.run.threadId, runId: input.run.id },
    model: input.model,
    context: input.context,
    options: input.options,
    turnIndex: input.turnIndex,
    purpose: input.purpose,
    cacheScope: input.cacheScope ?? input.run,
    ...(input.phase ? { phase: input.phase } : {}),
    emit: (event) => record(EVENT_TYPES[event.kind], event.payload),
    compiledPrompt: input.compiledPrompt,
    recordCompiledPackage: (receipt) => record(COMPILED_PROMPT_PACKAGE_EVENT, receipt),
  });
}


async function append(
  store: ModelInvocationCaptureStore,
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
