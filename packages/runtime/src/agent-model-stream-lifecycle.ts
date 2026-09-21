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
import { redirectTruncatedToolContext } from "./model-truncated-tool-context.js";
import {
  guardModelThinkingLoop,
  shortThinkingLoopRetryOptions,
  thinkingLoopRetryMessage,
} from "./model-thinking-loop-guard.js";
import type { ModelThinkingLoopEvidence } from "./model-thinking-loop-policy.js";
import {
  recordContextOverflow,
  recordDetection,
} from "./agent-model-recovery-evidence.js";
import { captureCompiledModelInvocation } from "./model-invocation-capture.js";
import type { ModelInvocationCapsuleStore } from "./model-invocation-capsule-store.js";
import type { ModelRouteSession } from "./model-route.js";
import type { ModelRouteAttemptContext } from "./model-route.js";
import type { ModelRegistry } from "./models.js";
import { modelStream, streamCtx } from "./model-stream-cancellation.js";
import type { CompiledPromptArtifact } from "./prompt-compiler.js";
import type { RunBudgetTracker } from "./run-budget.js";
import type { LocalStore } from "./store.js";
import { recoverModelContextOverflow } from "./model-context-overflow-recovery.js";
import type { ModelHarnessExperimentProfile } from "./model-harness-experiment-profile.js";
import { RunContextCompactor } from "./run-context-compaction.js";
import type { RunContextCompactionPort } from "./run-context-compaction-types.js";
import { prepareAgentInvocationContext } from "./agent-invocation-context.js";
import { bindRunBudgetContext } from "./run-budget-context.js";
import {
  prepareHarnessModelCallBudget,
  assertHarnessModelCallBudget,
} from "./harness-model-call-budget.js";
import {
  runtimeContextDelivery,
  stripRuntimeContext,
} from "./runtime-context-delivery.js";

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
      runContextCompaction?: RunContextCompactionPort;
      refreshBudgetPrompt?: () => CompiledPromptArtifact;
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
  const runContextCompaction = new RunContextCompactor(
    input.host,
    input.run,
    input.budget,
    input.nextTurnIndex,
    input.onEvent,
  );
  const cancellation = streamCtx(
    input.host,
    input.budget,
    input.run,
    input.onEvent,
  );
  // Give a recovered model a few calls to act before restoring the requested
  // reasoning level. Neither each tool result nor one stall should cause an
  // immediate reset or a permanent reasoning downgrade for the whole Run.
  const shortReasoningThroughCall = new Map<string, number>();
  let modelCallIndex = 0;
  return (model, context, options) => {
    const callIndex = ++modelCallIndex;
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
            ? redirectTruncatedToolContext(
                stripRuntimeContext(input.run, attemptContext),
              )
            : redirectedContext(
                stripRuntimeContext(input.run, attemptContext),
                priorEvidence!,
              );
        const nextOptions = { ...attemptOptions, signal };
        const createCandidateSource = async (
          candidate: Model<Api>,
          routeContext?: ModelRouteAttemptContext,
        ) => {
          currentServingModel = candidate;
          const routeOptions = routeContext
            ? mergeRouteStreamOptions(nextOptions, routeContext.streamOptions)
            : nextOptions;
          const routedOptions =
            attempt === 1 &&
            (shortReasoningThroughCall.get(
              `${candidate.provider}/${candidate.id}`,
            ) ?? 0) < callIndex
              ? routeOptions
              : shortThinkingLoopRetryOptions(candidate, routeOptions);
          const extensionCall = input.prepareCall
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
          const modelCallPolicy =
            input.harnessExperimentProfile?.policies?.modelCall;
          const preparedCall = {
            ...extensionCall,
            options: prepareHarnessModelCallBudget(
              candidate,
              extensionCall.options,
              modelCallPolicy,
            ),
          };
          const createInvocation = async (
            recoveryAttempt: 0 | 1,
            baseContext = preparedCall.context,
          ) => {
            baseContext = stripRuntimeContext(input.run, baseContext);
            baseContext = await prepareAgentInvocationContext({
              context: baseContext,
              run: input.run,
              store: input.host.store,
              policy: input.harnessExperimentProfile?.policies?.context,
              budget: input.budget,
            });
            let compiledPrompt = input.buildCompiledPrompt(
              candidate,
              preparedCall.options,
              baseContext,
            );
            if (!input.finalizeCall && runtimeContextDelivery(compiledPrompt))
              throw new Error(
                "Runtime context delivery requires context projection finalization",
              );
            const finalizedCall = input.finalizeCall
              ? await input.finalizeCall({
                  run: input.run,
                  attempt,
                  model: candidate,
                  context: baseContext,
                  options: { ...preparedCall.options },
                  compiledPrompt,
                  recoveryAttempt,
                  runContextCompaction,
                  ...(input.harnessExperimentProfile?.policies?.context
                    .finalization === "request-aware-v2"
                    ? {
                        refreshBudgetPrompt: () => {
                          bindRunBudgetContext(baseContext, input.budget);
                          compiledPrompt = input.buildCompiledPrompt(
                            candidate,
                            preparedCall.options,
                            baseContext,
                          );
                          return compiledPrompt;
                        },
                      }
                    : {}),
                  ...(input.harnessExperimentProfile
                    ? {
                        harnessExperimentProfile:
                          input.harnessExperimentProfile,
                      }
                    : {}),
                  ...(input.onEvent ? { onEvent: input.onEvent } : {}),
                })
              : { context: baseContext, options: preparedCall.options };
            assertHarnessModelCallBudget(
              candidate,
              preparedCall.options,
              finalizedCall.options,
              modelCallPolicy,
            );
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
      onDetected: async (evidence, action, terminalMessage, trace) => {
        const result = await recordDetection(
          input,
          currentServingModel,
          evidence,
          action,
          currentEnvelope,
          terminalMessage,
          trace,
        );
        if (result === "retry") {
          shortReasoningThroughCall.set(
            `${currentServingModel.provider}/${currentServingModel.id}`,
            callIndex + 3,
          );
        }
        return result;
      },
    });
  };
}

function mergeRouteStreamOptions(
  base: SimpleStreamOptions,
  route: ModelRouteAttemptContext["streamOptions"],
): SimpleStreamOptions {
  const onResponse =
    base.onResponse || route.onResponse
      ? async (
          ...args: Parameters<NonNullable<SimpleStreamOptions["onResponse"]>>
        ) => {
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
