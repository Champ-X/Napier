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

import { attestHostModelAbort } from "./model-abort-provenance.js";
import { preserveModelAdmissionFailure } from "./model-call-admission.js";
import { MODEL_STREAM_CANCELLATION_GRACE_MS } from "./model-stream-cancellation-policy.js";
export { MODEL_STREAM_CANCELLATION_GRACE_MS } from "./model-stream-cancellation-policy.js";
import {
  createModelTurnDeadline,
  isModelTurnWatchdogError,
  type ModelTurnDeadlinePolicy,
} from "./model-turn-deadline.js";

const ABORTED = Symbol("model-stream-aborted");

export interface ModelStreamCancellationFailure {
  provider: string;
  model: string;
  graceMs: number;
}

export interface ModelStreamTransport {
  /** Already-admitted provider adapter; this layer never reserves another lease. */
  models: Pick<Models, "streamSimple">;
  remainingMs(): number;
  deadlinePolicy?: Partial<ModelTurnDeadlinePolicy>;
  onCancellationFailure?: (failure: ModelStreamCancellationFailure) => Promise<void> | void;
}

export function createCancellableModelStream(
  transport: ModelStreamTransport,
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions | undefined,
): AssistantMessageEventStream {
  const { models, onCancellationFailure } = transport;
  const deadline = createModelTurnDeadline({
    remainingRunMs: Math.max(1, transport.remainingMs()),
    ...(options?.signal ? { rootSignal: options.signal } : {}),
    ...(transport.deadlinePolicy
      ? { policy: transport.deadlinePolicy }
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
  void source?.result().then(
    () => { sourceSettled = true; },
    () => { sourceSettled = true; },
  );
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
            graceMs: MODEL_STREAM_CANCELLATION_GRACE_MS,
          }),
        ).catch(() => undefined);
      }, MODEL_STREAM_CANCELLATION_GRACE_MS);
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
      error: preserveModelAdmissionFailure(error, terminalMessage(model, "error", errorText(error))),
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
  const message = preserveModelAdmissionFailure(error, terminalMessage(model, "error", errorText(error)));
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
