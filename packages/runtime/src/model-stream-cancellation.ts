import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type Models,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";

import type { ModelRegistry } from "./models.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import type { LocalStore } from "./store.js";
import type { RunRecord } from "@napier/contracts";
import type { RunBudgetTracker } from "./run-budget.js";
import { attestHostModelAbort } from "./model-abort-provenance.js";
import {
  createModelTurnDeadline,
  isModelTurnWatchdogError,
  type ModelTurnDeadlinePolicy,
} from "./model-turn-deadline.js";

const ABORTED = Symbol("model-stream-aborted");
const CANCELLATION_GRACE_MS = 5_000;

export interface ModelStreamCancellationFailure {
  provider: string;
  model: string;
  graceMs: number;
}

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

function cancelFailureSink(
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
  const onCancellationFailure = cancelFailureSink(cancellation);
  const models: Models = cancellation.registry.models;
  const deadline = createModelTurnDeadline({
    remainingRunMs: Math.max(1, cancellation.budget.remainingTimeoutMs()),
    ...(options?.signal ? { rootSignal: options.signal } : {}),
    ...(cancellation.deadlinePolicy
      ? { policy: cancellation.deadlinePolicy }
      : {}),
  });
  const streamOptions = { ...options, signal: deadline.signal };
  const output = createAssistantMessageEventStream();
  const signal = deadline.signal;
  if (signal?.aborted) {
    return attachAbortIsolation(
      output,
      model,
      undefined,
      signal,
      onCancellationFailure,
    );
  }
  try {
    return attachAbortIsolation(
      output,
      model,
      models.streamSimple(model, context, streamOptions),
      signal,
      onCancellationFailure,
      deadline,
    );
  } catch (error) {
    return attachAbortIsolation(
      output,
      model,
      terminalErrorStream(model, error),
      signal,
      onCancellationFailure,
      deadline,
    );
  }
}

function attachAbortIsolation(
  output: AssistantMessageEventStream,
  model: Model<Api>,
  source: AssistantMessageEventStream | undefined,
  signal: AbortSignal | undefined,
  onCancellationFailure:
    | ((failure: ModelStreamCancellationFailure) => Promise<void> | void)
    | undefined,
  deadline?: ReturnType<typeof createModelTurnDeadline>,
): AssistantMessageEventStream {
  let resolveAbort: () => void = () => undefined;
  const abortPromise = new Promise<typeof ABORTED>((resolve) => {
    resolveAbort = () => resolve(ABORTED);
  });
  let resolveTerminal: (message: AssistantMessage) => void = () => undefined;
  const terminal = new Promise<AssistantMessage>((resolve) => {
    resolveTerminal = resolve;
  });
  let iterator: AsyncIterator<AssistantMessageEvent> | undefined;
  let sourceSettled = source === undefined;
  void source?.result().then(() => {
    sourceSettled = true;
  });
  let abortedEvent:
    | Extract<AssistantMessageEvent, { type: "error" }>
    | undefined;
  let settled = false;
  const settle = (message: AssistantMessage): void => {
    if (settled) return;
    settled = true;
    resolveTerminal(message);
  };
  const abort = (): void => {
    if (settled) return;
    const watchdog = isModelTurnWatchdogError(signal?.reason)
      ? signal.reason
      : undefined;
    const message = terminalMessage(
      model,
      "aborted",
      watchdog?.message ?? "Model stream was aborted by the active Run.",
    );
    attestHostModelAbort(
      message,
      watchdog
        ? { owner: "watchdog", evidence: watchdog.evidence }
        : { owner: "caller" },
    );
    abortedEvent = {
      type: "error",
      reason: "aborted",
      error: message,
    };
    settle(abortedEvent.error);
    resolveAbort();
    void Promise.resolve(iterator?.return?.()).catch(() => undefined);
    if (source && onCancellationFailure) {
      const timer = setTimeout(() => {
        if (sourceSettled) return;
        void Promise.resolve(
          onCancellationFailure({
            provider: model.provider,
            model: model.id,
            graceMs: CANCELLATION_GRACE_MS,
          }),
        ).catch(() => undefined);
      }, CANCELLATION_GRACE_MS);
      timer.unref?.();
    }
  };
  const failure = (
    error: unknown,
  ): Extract<AssistantMessageEvent, { type: "error" }> => {
    if (abortedEvent) return abortedEvent;
    const event = {
      type: "error",
      reason: "error",
      error: terminalMessage(model, "error", errorText(error)),
    } as const;
    settle(event.error);
    return event;
  };

  output[Symbol.asyncIterator] = async function* () {
    iterator = source?.[Symbol.asyncIterator]();
    try {
      while (true) {
        if (abortedEvent) {
          yield abortedEvent;
          return;
        }
        if (settled || !iterator || !source) return;
        const step = signal
          ? await Promise.race([iterator.next(), abortPromise])
          : await iterator.next();
        if (step === ABORTED) {
          yield abortedEvent!;
          return;
        }
        if (step.done) {
          const result = signal
            ? await Promise.race([source.result(), abortPromise])
            : await source.result();
          if (result === ABORTED) {
            yield abortedEvent!;
            return;
          }
          settle(result);
          return;
        }
        if (signal?.aborted) {
          abort();
          yield abortedEvent!;
          return;
        }
        const event = step.value;
        deadline?.observe(event);
        if (event.type === "done" || event.type === "error") {
          settle(event.type === "done" ? event.message : event.error);
        }
        yield event;
        if (settled) return;
      }
    } catch (error) {
      yield failure(error);
    } finally {
      deadline?.finish();
      signal?.removeEventListener("abort", abort);
      iterator = undefined;
    }
  };
  output.result = () => terminal;
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  return output;
}

function terminalErrorStream(
  model: Model<Api>,
  error: unknown,
): AssistantMessageEventStream {
  const message = terminalMessage(model, "error", errorText(error));
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "error", reason: "error", error: message });
  return stream;
}

function terminalMessage(
  model: Model<Api>,
  stopReason: "aborted" | "error",
  errorMessage: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason,
    errorMessage,
    timestamp: Date.now(),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
