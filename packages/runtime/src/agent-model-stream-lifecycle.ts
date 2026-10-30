import { modelResultAttribution } from "./model-call-attribution.js";
import type { ModelCallAttributionV1 } from "@napier/contracts/model-accounting";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
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
  recordContextOverflowStopped,
  recordHiddenContextOverflowResponse,
  recordDetection,
} from "./agent-model-recovery-evidence.js";
import { captureCompiledModelInvocation } from "./model-invocation-capture.js";
import type { ModelInvocationCapsuleStore } from "./model-invocation-capsule-store.js";
import type { ModelRouteSession } from "./model-route.js";
import type { ModelRouteAttemptContext } from "./model-route.js";
import { mergeRouteStreamOptions } from "./model-route-options.js";
import type { ModelRegistry } from "./models.js";
import { modelStreamCancellationFailureSink, streamCtx } from "./model-stream-cancellation.js";
import { ModelSession } from "./model-session.js";
import type { ModelCallRecoveryHandle } from "./model-call-recovery.js";
import type { RunBudgetTracker } from "./run-budget.js";
import type { LocalStore } from "./store.js";
import { recoverModelContextOverflow } from "./model-context-overflow-recovery.js";
import { RunContextCompactor } from "./run-context-compaction.js";
import { createAgentInvocationContextPreparer } from "./agent-invocation-context.js";
import { bindRunBudgetContext } from "./run-budget-context.js";
import { prepareCompiledModelInvocation } from "./model-call-compiled-preparation.js";
import {
  prepareHarnessModelCallBudget,
} from "./harness-model-call-budget.js";
import {
  stripRuntimeContext,
} from "./runtime-context-delivery.js";

import type { AgentModelCallPreparation, AgentModelCallFinalization, AgentModelInvocation,
  PreparedAgentModelCall, CompiledModelPromptBuilder } from "./model-call-lifecycle-types.js";
export type { AgentModelCallPreparation, AgentModelInvocation, PreparedAgentModelCall } from "./model-call-lifecycle-types.js";

export interface AgentModelStreamLifecycleInput {
  host: {
    store: LocalStore;
    modelRegistry: ModelRegistry;
    modelInvocationCapsules: ModelInvocationCapsuleStore;
  };
  budget: RunBudgetTracker;
  run: RunRecord;
  harnessExperimentProfile?: AgentModelCallPreparation["harnessExperimentProfile"];
  modelRoute?: ModelRouteSession;
  buildCompiledPrompt: CompiledModelPromptBuilder;
  nextTurnIndex(): number;
  onEnvelope(envelope: ModelContextEnvelopeReceipt | undefined): void;
  prepareCall?(
    call: AgentModelCallPreparation,
  ): PreparedAgentModelCall | Promise<PreparedAgentModelCall>;
  finalizeCall?(
    call: AgentModelCallFinalization,
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
  const prepareInvocationContext = createAgentInvocationContextPreparer({ store: input.host.store, run: input.run });
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
  const session = new ModelSession({
    models: input.host.modelRegistry.models,
    lifetime: {
      remainingMs: () => input.budget.remainingTimeoutMs(),
      assertActive: () => {
        if (input.budget.remainingTimeoutMs() <= 0) input.budget.exhaustTimeout();
        input.budget.throwIfExhausted();
      },
    },
    ...(cancellation.deadlinePolicy ? { deadlinePolicy: cancellation.deadlinePolicy } : {}),
    onCancellationFailure: modelStreamCancellationFailureSink(cancellation),
  });
  // Give a recovered model a few calls to act before restoring the requested
  // reasoning level. Neither each tool result nor one stall should cause an
  // immediate reset or a permanent reasoning downgrade for the whole Run.
  const shortReasoningThroughCall = new Map<string, number>();
  let modelCallIndex = 0;
  return (model, context, options) => {
    const callIndex = ++modelCallIndex;
    let currentAttribution: ModelCallAttributionV1 | undefined;
    let currentEnvelope: ModelContextEnvelopeReceipt | undefined;
    let currentServingModel = model;
    const rootSignal = options?.signal ?? new AbortController().signal;
    let thinkingRetryUsed = false;
    let overflowRetryUsed = false;
    const createCandidateStream = (servingModel: Model<Api>, routeContext?: ModelRouteAttemptContext) => guardModelThinkingLoop({
      nativeAccounting: !!input.host.modelRegistry.accountingRepository,
      remainingMs: () => input.budget.remainingTimeoutMs(),
      attribution: () => currentAttribution,
      model: servingModel,
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
        let attemptRecovery: ModelCallRecoveryHandle | undefined;
        let attemptAttribution: ModelCallAttributionV1 | undefined;
        let attemptLogicalSource: AssistantMessageEventStream | undefined;
        const recovery = () => ({ ...(attemptRecovery ? { handle: attemptRecovery } : {}),
          ...(attemptAttribution ? { attribution: attemptAttribution } : {}) });
        const logicalResult = () => {
          if (!attemptLogicalSource) throw new Error("Thinking recovery has no logical model attempt");
          return attemptLogicalSource.result();
        };
        currentAttribution = undefined;
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
            baseContext = await prepareInvocationContext({
              context: baseContext,
              policy: input.harnessExperimentProfile?.policies?.context,
              budget: input.budget,
            });
            const finalizedCall = await prepareCompiledModelInvocation({
              call: {
                run: input.run, attempt, model: candidate, context: baseContext,
                options: preparedCall.options,
                ...(input.harnessExperimentProfile ? { harnessExperimentProfile: input.harnessExperimentProfile } : {}),
                ...(input.onEvent ? { onEvent: input.onEvent } : {}),
              },
              buildCompiledPrompt: input.buildCompiledPrompt,
              ...(input.finalizeCall ? { finalize: input.finalizeCall } : {}),
              recoveryAttempt, runContextCompaction,
              ...(input.harnessExperimentProfile?.policies?.context.finalization === "request-aware-v2"
                ? { refreshBudgetContext: (context: Context) => bindRunBudgetContext(context, input.budget) } : {}),
            });
            const { compiledPrompt } = finalizedCall;
            currentAttribution = undefined;
            await input.budget.refreshAccounting();
            if (attempt === 2) input.budget.assertCanStartAuxiliaryCall();
            const accounting = input.host.modelRegistry.accountingForRun(input.run.id);
            const opened = await session.open({
              phase: "agent_turn",
              onAttribution: (value) => { currentAttribution = value; },
              ...(accounting ? { accounting } : {}),
              model: candidate,
              context: finalizedCall.context,
              options: finalizedCall.options,
              capture: async ({ model, context, options }) => {
                const captured = await captureCompiledModelInvocation({
                  store: input.host.store,
                  capsules: input.host.modelInvocationCapsules,
                  run: input.run,
                  model,
                  context,
                  options,
                  turnIndex: input.nextTurnIndex(),
                  purpose: "agent_turn",
                  compiledPrompt,
                  ...(input.onEvent ? { onEvent: input.onEvent } : {}),
                });
                // Capture can finish after cancellation. Bind its durable receipt
                // before ModelSession rejects dispatch so the terminal still owns it.
                currentEnvelope = captured.envelope;
                input.onEnvelope(captured.envelope);
                return captured;
              },
              invoke: (captured, next) => {
                const call = {
                  run: input.run,
                  attempt,
                  model: captured.model,
                  context: captured.context,
                  options: captured.options ?? {},
                  compiledPrompt,
                  envelope: captured.envelope,
                  ...(input.onEvent ? { onEvent: input.onEvent } : {}),
                };
                return input.invokeCall ? input.invokeCall(call, next) : next();
              },
            });
            currentAttribution = modelResultAttribution(opened.source);
            attemptRecovery = opened.recovery;
            attemptAttribution = currentAttribution;
            attemptLogicalSource = opened.source;
            return { ...opened, options: opened.options ?? {} };
          };
          const first = await createInvocation(0);
          let active = first;
          let overflowEventSha256: string | undefined;
          return {
            recovery,
            logicalResult,
            get context() { return active.context; },
            get options() { return active.options; },
            source: recoverModelContextOverflow({
              source: first.source,
              signal,
              nativeAccounting: !!input.host.modelRegistry.accountingRepository,
              remainingMs: () => input.budget.remainingTimeoutMs(),
              recovery,
              claimRetry: () => { if (overflowRetryUsed) return false; overflowRetryUsed = true; return true; },
              onOverflow: async (error, decision) => {
                const evidence = await recordContextOverflow(
                  input,
                  candidate,
                  error,
                  first.envelope,
                  decision,
                );
                overflowEventSha256 = evidence.contentSha256;
                if (decision.action === "retry" && evidence.action !== "retry") return false;
              },
              onRecoveryStopped: async (readiness) => {
                if (overflowEventSha256) await recordContextOverflowStopped(input, overflowEventSha256, readiness);
              },
              recover: async (error) => {
                currentEnvelope = undefined;
                input.onEnvelope(undefined);
                await recordHiddenContextOverflowResponse(input, candidate, error, first.envelope);
                input.budget.throwIfExhausted();
                signal.throwIfAborted();
                active = await createInvocation(1, active.context);
                return active.source;
              },
            }),
          };
        };
        return createCandidateSource(servingModel, routeContext);
      },
      onDetected: async (evidence, action, terminalMessage, trace, recovery) => {
        const result = await recordDetection(
          input,
          currentServingModel,
          evidence,
          action === "retry" && thinkingRetryUsed ? "finalize" : action,
          currentEnvelope,
          terminalMessage,
          trace,
          currentAttribution,
          recovery,
        );
        if (result === "retry") {
          thinkingRetryUsed = true;
          shortReasoningThroughCall.set(
            `${currentServingModel.provider}/${currentServingModel.id}`,
            callIndex + 3,
          );
        }
        return result;
      },
    });
    return input.modelRoute ? input.modelRoute.stream({ signal: rootSignal,
      invoke: async (candidate, routeContext) => createCandidateStream(candidate, routeContext) }) : createCandidateStream(model);
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
