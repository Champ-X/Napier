import {
  createAssistantMessageEventStream,
  getSupportedThinkingLevels,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";

import { ModelThinkingLoopDetector } from "./model-thinking-loop-detector.js";
import { modelAdapterReceipt } from "./model-adapters.js";
import {
  ModelThinkingLoopError,
  type ModelThinkingLoopEvidence,
} from "./model-thinking-loop-policy.js";
import { ModelSemanticStallObserver } from "./model-semantic-stall-observer.js";
import {
  ModelThinkingTrace,
  type ModelThinkingTraceSnapshot,
} from "./model-thinking-trace.js";
import {
  MAX_UNCOMMITTED_THINKING_BYTES,
  thinkingDeltaBytes,
} from "./model-output-commit-policy.js";

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
    terminalMessage?: AssistantMessage,
    trace?: ModelThinkingTraceSnapshot,
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
        let terminalMessage: AssistantMessage | undefined;
        const semanticStall = new ModelSemanticStallObserver();
        const thinkingTrace = new ModelThinkingTrace();

        try {
          while (true) {
            const step = await currentIterator.next();
            const event = step.done
              ? eventFromMessage(await created.source.result())
              : step.value;
            if (event.type === "done" || event.type === "error") {
              detected = semanticStall.terminalEvidence(event, attempt);
              if (detected) {
                // A watchdog error is synthesized locally and may carry zero
                // usage; retain the observed-byte estimate for that attempt.
                terminalMessage =
                  event.type === "done" ? event.message : undefined;
                break;
              }
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
            thinkingTrace.observeEvent(event);
            if (buffering) {
              buffered.push(event);
              if (event.type === "thinking_delta") {
                bufferedBytes += thinkingDeltaBytes(event);
                detected = detector.observe(event.delta, attempt);
                if (detected) break;
                if (bufferedBytes >= MAX_UNCOMMITTED_THINKING_BYTES) {
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
          terminalMessage,
          thinkingTrace.snapshot(),
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
    "Keep tool arguments complete. Split large deliverables into small coherent edits; do not try to write an entire application in one call. After a successful write, use its returned SHA-256 for the next edit.",
  ].join("\n");
}

export function shortThinkingLoopRetryOptions(
  model: Model<Api>,
  options: SimpleStreamOptions,
): SimpleStreamOptions {
  const { reasoning: _previousReasoning, ...rest } = options;
  const supported = getSupportedThinkingLevels(model);
  // An unsupported "minimal" can be clamped upward by the provider (for
  // example, to "high"). Prefer an actual short level, then off when allowed;
  // compulsory-reasoning models retain their lowest supported level.
  const selected = supported.includes("minimal")
    ? "minimal"
    : supported.includes("low")
      ? "low"
      : supported.includes("off")
        ? "off"
        : supported[0];
  if (!selected) throw new Error("Model has no supported thinking retry level");
  return {
    ...rest,
    // Reasoning and serialized tool arguments share this ceiling. Reduce the
    // reasoning level, but retain the ordinary bounded output allowance so
    // recovery does not manufacture a truncated, non-executable write.
    maxTokens: modelAdapterReceipt(model, options).streamOptionMaxTokens,
    ...(selected && selected !== "off" ? { reasoning: selected } : {}),
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
