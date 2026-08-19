import type { StreamFn } from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  UserMessage,
} from "@earendil-works/pi-ai";
import type { ModelContextEnvelopeReceipt, RunRecord } from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import {
  guardModelThinkingLoop,
  shortThinkingLoopRetryOptions,
  thinkingLoopRetryMessage,
} from "./model-thinking-loop-guard.js";
import type { ModelThinkingLoopEvidence } from "./model-thinking-loop-policy.js";
import { captureCompiledModelInvocation } from "./model-invocation-capture.js";
import type { ModelInvocationCapsuleStore } from "./model-invocation-capsule-store.js";
import type { ModelRegistry } from "./models.js";
import { modelStream, streamCtx } from "./model-stream-cancellation.js";
import type { CompiledPromptArtifact } from "./prompt-compiler.js";
import type { RunBudgetTracker } from "./run-budget.js";
import type { LocalStore } from "./store.js";
import { canonicalJson, sha256 } from "./ed25519.js";

export interface AgentModelCallPreparation {
  run: RunRecord;
  attempt: number;
  model: Model<Api>;
  context: Context;
  options: SimpleStreamOptions;
  onEvent?: EventSink;
}

export interface PreparedAgentModelCall {
  context: Context;
  options: SimpleStreamOptions;
}

export interface AgentModelInvocation extends AgentModelCallPreparation {
  compiledPrompt: CompiledPromptArtifact;
  envelope: ModelContextEnvelopeReceipt;
}

export interface AgentModelStreamLifecycleInput {
  host: {
    store: LocalStore;
    modelRegistry: ModelRegistry;
    modelInvocationCapsules: ModelInvocationCapsuleStore;
  };
  budget: RunBudgetTracker;
  run: RunRecord;
  buildCompiledPrompt(
    model: Model<Api>,
    options: SimpleStreamOptions | undefined,
    context: Context,
  ): CompiledPromptArtifact;
  nextTurnIndex(): number;
  onEnvelope(envelope: ModelContextEnvelopeReceipt): void;
  prepareCall?(
    call: AgentModelCallPreparation,
  ): PreparedAgentModelCall | Promise<PreparedAgentModelCall>;
  invokeCall?(
    call: AgentModelInvocation,
    next: () => AssistantMessageEventStream,
  ): AssistantMessageEventStream;
  onEvent?: EventSink;
}

export function agentModelStreamLife(
  input: AgentModelStreamLifecycleInput,
): StreamFn {
  const cancellation = streamCtx(
    input.host,
    input.budget,
    input.run,
    input.onEvent,
  );
  return (model, context, options) => {
    let currentEnvelope: ModelContextEnvelopeReceipt | undefined;
    const rootSignal = options?.signal ?? new AbortController().signal;
    return guardModelThinkingLoop({
      model,
      context,
      options: options ?? {},
      rootSignal,
      createSource: async ({
        attempt,
        context: attemptContext,
        options: attemptOptions,
        signal,
        priorEvidence,
      }) => {
        const nextContext =
          attempt === 1
            ? attemptContext
            : redirectedContext(attemptContext, priorEvidence!);
        const nextOptions =
          attempt === 1
            ? { ...attemptOptions, signal }
            : {
                ...shortThinkingLoopRetryOptions(model, attemptOptions),
                signal,
              };
        const preparedCall = input.prepareCall
          ? await input.prepareCall({
              run: input.run,
              attempt,
              model,
              context: nextContext,
              options: nextOptions,
              ...(input.onEvent ? { onEvent: input.onEvent } : {}),
            })
          : { context: nextContext, options: nextOptions };
        const compiledPrompt = input.buildCompiledPrompt(
          model,
          preparedCall.options,
          preparedCall.context,
        );
        const captured = await captureCompiledModelInvocation({
          store: input.host.store,
          capsules: input.host.modelInvocationCapsules,
          run: input.run,
          model,
          context: preparedCall.context,
          options: preparedCall.options,
          turnIndex: input.nextTurnIndex(),
          purpose: "agent_turn",
          compiledPrompt,
          ...(input.onEvent ? { onEvent: input.onEvent } : {}),
        });
        currentEnvelope = captured.envelope;
        input.onEnvelope(captured.envelope);
        return {
          context: captured.context,
          options: preparedCall.options,
          source: input.invokeCall
            ? input.invokeCall(
                {
                  run: input.run,
                  attempt,
                  model,
                  context: captured.context,
                  options: preparedCall.options,
                  compiledPrompt,
                  envelope: captured.envelope,
                },
                () =>
                  modelStream(
                    cancellation,
                    model,
                    captured.context,
                    preparedCall.options,
                  ),
              )
            : modelStream(
                cancellation,
                model,
                captured.context,
                preparedCall.options,
              ),
        };
      },
      onDetected: (evidence, action) =>
        recordDetection(input, model, evidence, action, currentEnvelope),
    });
  };
}

function redirectedContext(
  context: Context,
  evidence: ModelThinkingLoopEvidence,
): Context {
  const redirect: UserMessage = {
    role: "user",
    content: thinkingLoopRetryMessage(evidence),
    timestamp: Date.now(),
  };
  return {
    ...context,
    messages: [...context.messages, redirect],
  };
}

async function recordDetection(
  input: AgentModelStreamLifecycleInput,
  model: Model<Api>,
  evidence: ModelThinkingLoopEvidence,
  action: "retry" | "finalize",
  envelope: ModelContextEnvelopeReceipt | undefined,
): Promise<"retry" | "finalize" | "budget_exhausted"> {
  input.budget.observeAuxiliaryUsage({
    inputTokens: 0,
    outputTokens: Math.ceil(evidence.observedBytes / 4),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  });
  const effectiveAction = input.budget.exhaustion
    ? ("budget_exhausted" as const)
    : action;
  const content = {
    kind: "napier.model-thinking-loop" as const,
    schemaVersion: 1 as const,
    action: effectiveAction,
    provider: model.provider,
    model: model.id,
    ...evidence,
    ...(effectiveAction === "retry" && envelope
      ? {
          modelContextEnvelopeSha256: envelope.contentSha256,
          modelContextEnvelopeTurnIndex: envelope.turnIndex,
          modelContextMessageSetSha256: envelope.messageSetSha256,
          modelContextToolDefinitionSetSha256: envelope.toolDefinitionSetSha256,
        }
      : {}),
  };
  const event = await input.host.store.appendEvent({
    threadId: input.run.threadId,
    runId: input.run.id,
    type: "model.thinking_loop.detected",
    category: "model",
    visibility: effectiveAction === "retry" ? "debug" : "user",
    payload: {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    },
  });
  if (input.onEvent) {
    try {
      await input.onEvent(event);
    } catch {
      // Durable thinking-loop evidence survives a disconnected stream.
    }
  }
  return effectiveAction;
}
