import type { ModelCallAttributionV1 } from "@napier/contracts/model-accounting";
import { bindModelResultAttribution, markModelLogicalUndispatched } from "./model-call-attribution.js";
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
import { attestHostModelAbort } from "./model-abort-provenance.js";
import { ModelSemanticStallObserver } from "./model-semantic-stall-observer.js";
import { awaitModelCallRecovery, type ModelCallRecoveryHandle, type ModelRecoveryReadiness } from "./model-call-recovery.js";
import { MODEL_STREAM_CANCELLATION_GRACE_MS } from "./model-stream-cancellation-policy.js";
import { issueModelThinkingSuppression, type ModelThinkingSuppressionProof } from "./model-thinking-suppression.js";
import {
  ModelThinkingTrace,
  type ModelThinkingTraceSnapshot,
} from "./model-thinking-trace.js";
import {
  MAX_UNCOMMITTED_THINKING_BYTES,
  thinkingDeltaBytes,
} from "./model-output-commit-policy.js";

export interface ModelThinkingLoopAttemptSource {
  context: Context;
  options: SimpleStreamOptions;
  source: AssistantMessageEventStream;
  logicalResult?(): Promise<AssistantMessage>;
  recovery?(): { handle?: ModelCallRecoveryHandle; attribution?: ModelCallAttributionV1 };
  settleLogical?(message: AssistantMessage, suppressed?: ModelThinkingLoopEvidence, proof?: ModelThinkingSuppressionProof): Promise<void>;
}

export interface ModelThinkingLoopGuardInput {
  model: Model<Api>;
  context: Context;
  options: SimpleStreamOptions;
  rootSignal: AbortSignal;
  nativeAccounting?: boolean;
  remainingMs?(): number;
  attribution?(): ModelCallAttributionV1 | undefined;
  createSource(input: {
    attempt: 1 | 2;
    context: Context;
    options: SimpleStreamOptions;
    signal: AbortSignal;
    priorEvidence?: ModelThinkingLoopEvidence;
  }): Promise<ModelThinkingLoopAttemptSource>;
  onDetected(
    evidence: ModelThinkingLoopEvidence,
    action: "retry" | "finalize",
    terminalMessage?: AssistantMessage,
    trace?: ModelThinkingTraceSnapshot,
    recovery?: { readiness: ModelRecoveryReadiness; outputDisposition: "suppressed_thinking_recovery" },
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
  let currentSource: ModelThinkingLoopAttemptSource | undefined;
  let logicalSettled = false;
  let settled = false;
  const settle = (message: AssistantMessage): void => {
    if (settled) return;
    settled = true;
    const attribution = input.attribution?.();
    if (attribution) bindModelResultAttribution(message, attribution);
    else if (input.nativeAccounting) markModelLogicalUndispatched(message);
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
        currentSource = created;
        logicalSettled = false;
        context = created.context;
        options = created.options;
        currentIterator = created.source[Symbol.asyncIterator]();
        const observed = yield* consumeThinkingAttempt(created, currentIterator, attempt, async (message) => {
          await created.settleLogical?.(message);
          logicalSettled = true;
          settle(message);
        });
        if (!observed) return;
        const { evidence: detected, terminalMessage, logicalMessage, trace } = observed;
        const recoveryDeadlineAt = Date.now() + Math.max(0, Math.min(
          MODEL_STREAM_CANCELLATION_GRACE_MS, input.remainingMs?.() ?? MODEL_STREAM_CANCELLATION_GRACE_MS,
        ));
        currentController.abort(new ModelThinkingLoopError(detected));
        closeIterator(currentIterator);
        currentIterator = undefined;
        currentController = undefined;
        const readiness = await settleSuppressedAttempt(input, created, detected, logicalMessage, recoveryDeadlineAt);
        logicalSettled = true;
        const retryReady = ["known", "undispatched", "legacy_unaccounted"].includes(readiness);
        let action = await input.onDetected(
          detected,
          attempt === 1 && retryReady ? "retry" : "finalize",
          terminalMessage,
          trace,
          { readiness, outputDisposition: "suppressed_thinking_recovery" },
        );
        if (action === "retry" && attempt === 1 && retryReady) {
          if (retryWithinDeadline(input, recoveryDeadlineAt)) {
            // An inner context-overflow recovery may have replaced the active
            // request while this thinking attempt was being consumed.
            context = created.context;
            options = created.options;
            priorEvidence = detected;
            continue;
          }
          if (!input.rootSignal.aborted) action = await input.onDetected(detected, "finalize", terminalMessage, trace,
            { readiness: "pending_timeout", outputDisposition: "suppressed_thinking_recovery" });
        }
        const final = detectionTerminal(input, action, detected);
        settle(final.type === "done" ? final.message : final.error);
        yield final;
        return;
      }
    } catch (error) {
      const message = errorMessage(input.model, error);
      settle(message);
      yield { type: "error", reason: "error", error: message };
    } finally {
      currentController?.abort(new Error("Thinking-loop stream closed"));
      closeIterator(currentIterator);
      if (!logicalSettled && currentSource && (currentSource.settleLogical || currentSource.logicalResult)) {
        const message = await (currentSource.logicalResult?.() ?? currentSource.source.result());
        await currentSource.settleLogical?.(message);
        settle(message);
      }
      currentController = undefined;
      currentIterator = undefined;
    }
  };
  output.result = () => terminal;
  return output;
}

interface ObservedThinkingSuppression {
  evidence: ModelThinkingLoopEvidence;
  logicalMessage?: AssistantMessage;
  terminalMessage?: AssistantMessage;
  trace: ModelThinkingTraceSnapshot;
}

async function* consumeThinkingAttempt(created: ModelThinkingLoopAttemptSource,
  iterator: AsyncIterator<AssistantMessageEvent>, attempt: 1 | 2,
  accepted: (message: AssistantMessage) => Promise<void>): AsyncGenerator<AssistantMessageEvent, ObservedThinkingSuppression | undefined> {
  const detector = new ModelThinkingLoopDetector(), semanticStall = new ModelSemanticStallObserver(), trace = new ModelThinkingTrace();
  const buffered: AssistantMessageEvent[] = [];
  let bufferedBytes = 0, buffering = true;
  for (;;) {
    const step = await iterator.next();
    const event = step.done ? eventFromMessage(await created.source.result()) : step.value;
    if (event.type === "done" || event.type === "error") {
      const message = event.type === "done" ? event.message : event.error;
      const evidence = semanticStall.terminalEvidence(event, attempt);
      if (evidence) return { evidence, logicalMessage: message, trace: trace.snapshot(),
        // A synthetic watchdog zero is never physical usage evidence.
        ...(event.type === "done" ? { terminalMessage: message } : {}) };
      await accepted(message);
      if (buffering) { buffered.push(event); yield* buffered; }
      else yield event;
      return;
    }
    semanticStall.observe(event);
    trace.observeEvent(event);
    if (!buffering) { yield event; continue; }
    buffered.push(event);
    if (event.type === "thinking_delta") {
      bufferedBytes += thinkingDeltaBytes(event);
      const evidence = detector.observe(event.delta, attempt);
      if (evidence) return { evidence, trace: trace.snapshot() };
      if (bufferedBytes >= MAX_UNCOMMITTED_THINKING_BYTES) { yield* buffered; buffered.length = 0; buffering = false; }
      continue;
    }
    if (isThinkingPreamble(event)) continue;
    yield* buffered;
    buffered.length = 0;
    buffering = false;
  }
}

function retryWithinDeadline(input: ModelThinkingLoopGuardInput, deadlineAt: number): boolean {
  return !input.rootSignal.aborted && (!input.nativeAccounting ||
    (Date.now() < deadlineAt && (input.remainingMs?.() ?? 1) > 0));
}

function detectionTerminal(input: ModelThinkingLoopGuardInput, action: "retry" | "finalize" | "budget_exhausted",
  evidence: ModelThinkingLoopEvidence): Extract<AssistantMessageEvent, { type: "done" | "error" }> {
  if (input.rootSignal.aborted) {
    const error = attestHostModelAbort({ ...errorMessage(input.model, input.rootSignal.reason ?? "Model owner cancelled recovery"),
      stopReason: "aborted" }, { owner: "caller" });
    return { type: "error", reason: "aborted", error };
  }
  if (action === "budget_exhausted") return { type: "done", reason: "length", message: budgetMessage(input.model) };
  return { type: "error", reason: "error", error: errorMessage(input.model, new ModelThinkingLoopError(evidence)) };
}

function closeIterator(iterator: AsyncIterator<AssistantMessageEvent> | undefined): void {
  try { void Promise.resolve(iterator?.return?.()).catch(() => undefined); }
  catch { /* A broken provider close cannot bypass logical settlement or the retry bound. */ }
}

async function settleSuppressedAttempt(input: ModelThinkingLoopGuardInput, created: ModelThinkingLoopAttemptSource,
  evidence: ModelThinkingLoopEvidence, logicalMessage: AssistantMessage | undefined, deadlineAt: number): Promise<ModelRecoveryReadiness> {
  // This is the isolated logical terminal, never the admitted raw result.
  // Main calls have no child reservation; child settlement durably closes
  // its reservation before the independent physical readiness wait.
  const message = logicalMessage ?? (created.logicalResult ? await created.logicalResult() :
    created.settleLogical ? await created.source.result() : undefined);
  const binding = created.recovery?.();
  if (created.settleLogical && message) await created.settleLogical(message, evidence,
    issueModelThinkingSuppression({ message, evidence, ...(binding?.attribution ? { attribution: binding.attribution } : {}) }));
  if (evidence.attempt === 2) return "not_requested";
  if (!input.nativeAccounting) return "legacy_unaccounted";
  return awaitModelCallRecovery({ handle: binding?.handle, attribution: binding?.attribution,
    signal: input.rootSignal, deadlineAt });
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
