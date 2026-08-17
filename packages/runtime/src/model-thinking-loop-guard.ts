import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";

import { ModelThinkingLoopDetector } from "./model-thinking-loop-detector.js";
import {
  ModelThinkingLoopError,
  type ModelThinkingLoopEvidence,
} from "./model-thinking-loop-policy.js";
import { ModelSemanticStallObserver } from "./model-semantic-stall-observer.js";

const MAX_BUFFERED_THINKING_BYTES = 32 * 1024;

export interface ModelThinkingLoopGuardInput {
  model: Model<Api>;
  context: Context;
  options: SimpleStreamOptions;
  rootSignal: AbortSignal;
  createSource(input: {
    attempt: 1 | 2;
    context: Context;
    options: SimpleStreamOptions;
    signal: AbortSignal;
    priorEvidence?: ModelThinkingLoopEvidence;
  }): Promise<{
    context: Context;
    options: SimpleStreamOptions;
    source: AssistantMessageEventStream;
  }>;
  onDetected(
    evidence: ModelThinkingLoopEvidence,
    action: "retry" | "finalize",
  ):
    | Promise<"retry" | "finalize" | "budget_exhausted">
    | "retry"
    | "finalize"
    | "budget_exhausted";
}

export function guardModelThinkingLoop(
  input: ModelThinkingLoopGuardInput,
): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  let resolveTerminal: (message: AssistantMessage) => void = () => undefined;
  const terminal = new Promise<AssistantMessage>((resolve) => {
    resolveTerminal = resolve;
  });
  let currentController: AbortController | undefined;
  let currentIterator: AsyncIterator<AssistantMessageEvent> | undefined;
  let settled = false;
  const settle = (message: AssistantMessage): void => {
    if (settled) return;
    settled = true;
    resolveTerminal(message);
  };

  output[Symbol.asyncIterator] = async function* () {
    let context = input.context;
    let options = input.options;
    let priorEvidence: ModelThinkingLoopEvidence | undefined;
    try {
      for (const attempt of [1, 2] as const) {
        currentController = new AbortController();
        const signal = AbortSignal.any([
          input.rootSignal,
          currentController.signal,
        ]);
        const created = await input.createSource({
          attempt,
          context,
          options,
          signal,
          ...(priorEvidence ? { priorEvidence } : {}),
        });
        context = created.context;
        options = created.options;
        currentIterator = created.source[Symbol.asyncIterator]();
        const detector = new ModelThinkingLoopDetector();
        const buffered: AssistantMessageEvent[] = [];
        let bufferedBytes = 0;
        let buffering = true;
        let detected: ModelThinkingLoopEvidence | undefined;
        const semanticStall = new ModelSemanticStallObserver();

        try {
          while (true) {
            const step = await currentIterator.next();
            if (step.done) {
              const message = await created.source.result();
              for (const event of buffered) yield event;
              const terminalEvent = eventFromMessage(message);
              settle(message);
              yield terminalEvent;
              return;
            }
            const event = step.value;
            if (event.type === "done" || event.type === "error") {
              detected = semanticStall.terminalEvidence(event, attempt);
              if (detected) break;
              const message =
                event.type === "done" ? event.message : event.error;
              settle(message);
              if (buffering) {
                buffered.push(event);
                for (const bufferedEvent of buffered) yield bufferedEvent;
              } else {
                yield event;
              }
              return;
            }
            semanticStall.observe(event);
            if (buffering) {
              buffered.push(event);
              if (event.type === "thinking_delta") {
                bufferedBytes += Buffer.byteLength(event.delta, "utf8");
                detected = detector.observe(event.delta, attempt);
                if (detected) break;
                if (bufferedBytes >= MAX_BUFFERED_THINKING_BYTES) {
                  for (const bufferedEvent of buffered) yield bufferedEvent;
                  buffered.length = 0;
                  buffering = false;
                }
                continue;
              }
              if (isThinkingPreamble(event)) continue;
              for (const bufferedEvent of buffered) yield bufferedEvent;
              buffered.length = 0;
              buffering = false;
            } else {
              yield event;
            }
          }
        } finally {
          if (detected) {
            currentController.abort(new ModelThinkingLoopError(detected));
            await Promise.resolve(currentIterator.return?.()).catch(
              () => undefined,
            );
          }
          currentIterator = undefined;
          currentController = undefined;
        }

        if (!detected) return;
        const action = await input.onDetected(
          detected,
          attempt === 1 ? "retry" : "finalize",
        );
        if (action === "retry") {
          priorEvidence = detected;
          continue;
        }
        if (action === "budget_exhausted") {
          const message = budgetMessage(input.model);
          settle(message);
          yield { type: "done", reason: "length", message };
          return;
        }
        const error = errorMessage(
          input.model,
          new ModelThinkingLoopError(detected),
        );
        settle(error);
        yield { type: "error", reason: "error", error };
        return;
      }
    } catch (error) {
      const message = errorMessage(input.model, error);
      settle(message);
      yield { type: "error", reason: "error", error: message };
    } finally {
      currentController?.abort(new Error("Thinking-loop stream closed"));
      await Promise.resolve(currentIterator?.return?.()).catch(() => undefined);
      currentController = undefined;
      currentIterator = undefined;
    }
  };
  output.result = () => terminal;
  return output;
}

export function thinkingLoopRetryMessage(
  evidence: ModelThinkingLoopEvidence,
): string {
  return [
    "Internal thinking-loop redirect: the previous hidden reasoning attempt was stopped before it became visible.",
    `Reason ${evidence.reason}; attempt ${String(evidence.attempt)}; evidence ${evidence.repeatedUnitSha256}.`,
    "Do not restate the plan or continue the prior reasoning pattern.",
    "Execute one smallest safe tool action now, or provide the shortest concrete partial result and stop.",
  ].join("\n");
}

export function shortThinkingLoopRetryOptions(
  model: Model<Api>,
  options: SimpleStreamOptions,
): SimpleStreamOptions {
  return {
    ...options,
    maxTokens: Math.min(options.maxTokens ?? model.maxTokens, 2_048),
    ...(model.reasoning ? { reasoning: "minimal" as const } : {}),
  };
}

function isThinkingPreamble(event: AssistantMessageEvent): boolean {
  return (
    event.type === "start" ||
    event.type === "thinking_start" ||
    event.type === "thinking_end"
  );
}

function eventFromMessage(
  message: AssistantMessage,
): Extract<AssistantMessageEvent, { type: "done" | "error" }> {
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    return {
      type: "error",
      reason: message.stopReason,
      error: message,
    };
  }
  return {
    type: "done",
    reason: message.stopReason,
    message,
  };
}

function errorMessage(model: Model<Api>, error: unknown): AssistantMessage {
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
    stopReason: "error",
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
  };
}

function budgetMessage(model: Model<Api>): AssistantMessage {
  const { errorMessage: _errorMessage, ...message } = errorMessage(model, "");
  return {
    ...message,
    stopReason: "length",
  };
}
