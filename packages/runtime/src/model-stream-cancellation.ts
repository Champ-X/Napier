import type { Api, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { RunRecord } from "@napier/contracts";

import type { ModelRegistry } from "./models.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import type { LocalStore } from "./store.js";
import type { RunBudgetTracker } from "./run-budget.js";
import type { ModelTurnDeadlinePolicy } from "./model-turn-deadline.js";
import { createCancellableModelStream, type ModelStreamCancellationFailure } from "./model-stream-transport.js";
export type { ModelStreamCancellationFailure } from "./model-stream-transport.js";

export interface ModelStreamCancellationContext {
  budget: RunBudgetTracker;
  deadlinePolicy?: Partial<ModelTurnDeadlinePolicy>;
  registry: ModelRegistry;
  store: LocalStore;
  run: Pick<RunRecord, "id" | "threadId">;
  onEvent: EventSink | undefined;
}

export function streamCtx(
  host: {
    modelRegistry: ModelRegistry;
    store: LocalStore;
  },
  budget: RunBudgetTracker,
  run: Pick<RunRecord, "id" | "threadId">,
  onEvent: EventSink | undefined,
): ModelStreamCancellationContext {
  return {
    budget,
    ...(host.modelRegistry.modelTurnDeadlinePolicy
      ? { deadlinePolicy: host.modelRegistry.modelTurnDeadlinePolicy }
      : {}),
    registry: host.modelRegistry,
    store: host.store,
    run,
    onEvent,
  };
}

export function modelStreamCancellationFailureSink(
  context: ModelStreamCancellationContext,
): (failure: ModelStreamCancellationFailure) => Promise<void> {
  return async (failure) => {
    const content = {
      kind: "napier.model-stream-cancellation-failure" as const,
      schemaVersion: 1 as const,
      provider: failure.provider,
      model: failure.model,
      graceMs: failure.graceMs,
    };
    const event = await context.store.appendEvent({
      threadId: context.run.threadId,
      runId: context.run.id,
      type: "model.stream.cancellation_failed",
      category: "model",
      visibility: "debug",
      payload: {
        ...content,
        contentSha256: sha256(canonicalJson(content)),
      },
    });
    if (!context.onEvent) return;
    try {
      await context.onEvent(event);
    } catch {
      // Durable cancellation evidence must survive a disconnected stream.
    }
  };
}

export function modelStream(
  cancellation: ModelStreamCancellationContext,
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions | undefined,
): AssistantMessageEventStream {
  return createCancellableModelStream({
    models: cancellation.registry.models,
    remainingMs: () => cancellation.budget.remainingTimeoutMs(),
    ...(cancellation.deadlinePolicy ? { deadlinePolicy: cancellation.deadlinePolicy } : {}),
    onCancellationFailure: modelStreamCancellationFailureSink(cancellation),
  }, model, context, options);
}
