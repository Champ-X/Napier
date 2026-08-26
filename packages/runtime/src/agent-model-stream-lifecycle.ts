import type { StreamFn } from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessage,
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
import type { ModelRouteSession } from "./model-route.js";
import type { ModelRouteAttemptContext } from "./model-route.js";
import type { ModelRegistry } from "./models.js";
import { modelStream, streamCtx } from "./model-stream-cancellation.js";
import type { CompiledPromptArtifact } from "./prompt-compiler.js";
import type { RunBudgetTracker } from "./run-budget.js";
import type { LocalStore } from "./store.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { recoverModelContextOverflow } from "./model-context-overflow-recovery.js";
import { mapModelUsage } from "./agent-model-projection.js";
import { createUsageAccounting } from "./token-accounting.js";
import type { ModelHarnessExperimentProfile } from "./model-harness-experiment-profile.js";

export interface AgentModelCallPreparation {
  run: RunRecord;
  attempt: number;
  model: Model<Api>;
  context: Context;
  options: SimpleStreamOptions;
  harnessExperimentProfile?: ModelHarnessExperimentProfile | undefined;
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
  harnessExperimentProfile?: ModelHarnessExperimentProfile | undefined;
  modelRoute?: ModelRouteSession;
  buildCompiledPrompt(
    model: Model<Api>,
    options: SimpleStreamOptions | undefined,
    context: Context,
  ): CompiledPromptArtifact;
  nextTurnIndex(): number;
  onEnvelope(envelope: ModelContextEnvelopeReceipt | undefined): void;
  prepareCall?(
    call: AgentModelCallPreparation,
  ): PreparedAgentModelCall | Promise<PreparedAgentModelCall>;
  finalizeCall?(
    call: AgentModelCallPreparation & {
      compiledPrompt: CompiledPromptArtifact;
      recoveryAttempt: 0 | 1;
    },
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
    let currentServingModel = model;
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
        currentEnvelope = undefined;
        input.onEnvelope(undefined);
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
        const createCandidateSource = async (
          candidate: Model<Api>,
          routeContext?: ModelRouteAttemptContext,
        ) => {
          currentServingModel = candidate;
          const routedOptions = routeContext
            ? mergeRouteStreamOptions(nextOptions, routeContext.streamOptions)
            : nextOptions;
          const preparedCall = input.prepareCall
            ? await input.prepareCall({
                run: input.run,
                attempt,
                model: candidate,
                context: nextContext,
                options: routedOptions,
                ...(input.harnessExperimentProfile
                  ? { harnessExperimentProfile: input.harnessExperimentProfile }
                  : {}),
                ...(input.onEvent ? { onEvent: input.onEvent } : {}),
              })
            : { context: nextContext, options: routedOptions };
          const createInvocation = async (
            recoveryAttempt: 0 | 1,
            baseContext = preparedCall.context,
          ) => {
            const compiledPrompt = input.buildCompiledPrompt(
              candidate,
              preparedCall.options,
              baseContext,
            );
            const finalizedCall = input.finalizeCall
              ? await input.finalizeCall({
                  run: input.run,
                  attempt,
                  model: candidate,
                  context: baseContext,
                  options: preparedCall.options,
                  compiledPrompt,
                  recoveryAttempt,
                  ...(input.harnessExperimentProfile
                    ? {
                        harnessExperimentProfile:
                          input.harnessExperimentProfile,
                      }
                    : {}),
                  ...(input.onEvent ? { onEvent: input.onEvent } : {}),
                })
              : preparedCall;
            const captured = await captureCompiledModelInvocation({
              store: input.host.store,
              capsules: input.host.modelInvocationCapsules,
              run: input.run,
              model: candidate,
              context: finalizedCall.context,
              options: finalizedCall.options,
              turnIndex: input.nextTurnIndex(),
              purpose: "agent_turn",
              compiledPrompt,
              ...(input.onEvent ? { onEvent: input.onEvent } : {}),
            });
            currentEnvelope = captured.envelope;
            input.onEnvelope(captured.envelope);
            const call = {
              run: input.run,
              attempt,
              model: candidate,
              context: captured.context,
              options: finalizedCall.options,
              compiledPrompt,
              envelope: captured.envelope,
              ...(input.onEvent ? { onEvent: input.onEvent } : {}),
            };
            return {
              context: captured.context,
              options: finalizedCall.options,
              envelope: captured.envelope,
              source: input.invokeCall
                ? input.invokeCall(call, () =>
                    modelStream(
                      cancellation,
                      candidate,
                      captured.context,
                      finalizedCall.options,
                    ),
                  )
                : modelStream(
                    cancellation,
                    candidate,
                    captured.context,
                    finalizedCall.options,
                  ),
            };
          };
          const first = await createInvocation(0);
          return {
            context: first.context,
            options: first.options,
            source: recoverModelContextOverflow({
              source: first.source,
              signal,
              recover: async (error) => {
                const action = await recordContextOverflow(
                  input,
                  candidate,
                  error,
                  first.envelope,
                );
                currentEnvelope = undefined;
                input.onEnvelope(undefined);
                if (action !== "retry") {
                  input.budget.throwIfExhausted();
                  throw new Error(
                    "Model context overflow recovery unavailable",
                  );
                }
                return (await createInvocation(1, first.context)).source;
              },
            }),
          };
        };
        if (input.modelRoute) {
          return {
            context: nextContext,
            options: nextOptions,
            source: input.modelRoute.stream({
              signal,
              invoke: async (candidate, routeContext) =>
                (await createCandidateSource(candidate, routeContext)).source,
            }),
          };
        }
        return createCandidateSource(model);
      },
      onDetected: (evidence, action) =>
        recordDetection(
          input,
          currentServingModel,
          evidence,
          action,
          currentEnvelope,
        ),
    });
  };
}

function mergeRouteStreamOptions(
  base: SimpleStreamOptions,
  route: ModelRouteAttemptContext["streamOptions"],
): SimpleStreamOptions {
  const onResponse =
    base.onResponse || route.onResponse
      ? async (...args: Parameters<NonNullable<SimpleStreamOptions["onResponse"]>>) => {
          await base.onResponse?.(...args);
          await route.onResponse?.(...args);
        }
      : undefined;
  return {
    ...base,
    ...route,
    ...(base.headers || route.headers
      ? { headers: { ...base.headers, ...route.headers } }
      : {}),
    ...(base.env || route.env ? { env: { ...base.env, ...route.env } } : {}),
    ...(onResponse ? { onResponse } : {}),
  };
}

async function recordContextOverflow(
  input: AgentModelStreamLifecycleInput,
  model: Model<Api>,
  error: AssistantMessage,
  envelope: ModelContextEnvelopeReceipt,
): Promise<"retry" | "budget_exhausted"> {
  const usage = mapModelUsage(error.usage);
  const usageAccounting = createUsageAccounting(
    { provider: model.provider, id: model.id },
    usage,
  );
  input.budget.observeAuxiliaryUsage(usage, Date.now(), usageAccounting);
  const action = input.budget.exhaustion
    ? ("budget_exhausted" as const)
    : ("retry" as const);
  const content = {
    kind: "napier.model-context-overflow" as const,
    schemaVersion: 1 as const,
    action,
    provider: model.provider,
    model: model.id,
    diagnosticSha256: sha256(error.errorMessage ?? ""),
    usage,
    usageAccounting,
    modelContextEnvelopeSha256: envelope.contentSha256,
    modelContextEnvelopeTurnIndex: envelope.turnIndex,
    modelContextMessageSetSha256: envelope.messageSetSha256,
    modelContextToolDefinitionSetSha256: envelope.toolDefinitionSetSha256,
  };
  const event = await input.host.store.appendEvent({
    threadId: input.run.threadId,
    runId: input.run.id,
    type: "model.context.overflow",
    category: "model",
    visibility: "debug",
    payload: { ...content, contentSha256: sha256(canonicalJson(content)) },
  });
  if (input.onEvent) {
    try {
      await input.onEvent(event);
    } catch {
      // Durable overflow evidence survives a disconnected stream.
    }
  }
  return action;
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
