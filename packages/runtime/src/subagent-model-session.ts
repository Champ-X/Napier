import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type MutableModels,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { emptyUsage, type JsonObject, type ModelContextEnvelopeReceipt, type RunEvent, type SubagentLimits, type SubagentTask } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import { captureExactModelInvocation, type ExactModelInvocationCaptureInput } from "./model-invocation-exact-capture.js";
import { ModelInvocationCapsuleStore } from "./model-invocation-capsule-store.js";
import type { ModelRouteStreamPort } from "./model-route-types.js";
import { mergeRouteStreamOptions } from "./model-route-options.js";
import { hostModelAbortProvenance } from "./model-abort-provenance.js";
import { ModelSession, type ModelSessionLifetime } from "./model-session.js";
import type { AppendEventInput } from "./store-event-service.js";
import type { RunEventQueryPort } from "./run-event-query-port.js";
import { prepareSubagentModelInvocation, type SubagentModelCallScope } from "./subagent-model-preparation.js";
import { SubagentExecutionLifetime } from "./subagent-execution-lifetime.js";
import { subagentModelTurnDeniedStream } from "./subagent-model-turn-denial.js";
import { addSubagentUsage, subagentJsonValue } from "./subagent-task-evidence.js";
import type { SubagentChildExecution, SubagentProgress } from "./subagent-child-execution.js";
import { createUsageAccounting } from "./token-accounting.js";
import { modelAccountingLinkage, modelResultAttribution } from "./model-call-attribution.js";
import { guardModelThinkingLoop, shortThinkingLoopRetryOptions, thinkingLoopRetryMessage,
  type ModelThinkingLoopAttemptSource } from "./model-thinking-loop-guard.js";
import type { ModelThinkingLoopEvidence } from "./model-thinking-loop-policy.js";
import { readModelRegistryRuntimeSettings } from "./model-registry-runtime-settings.js";
import { recoverModelContextOverflow } from "./model-context-overflow-recovery.js";
import { recordContextOverflow, recordContextOverflowStopped } from "./agent-model-recovery-evidence.js";
import type { ModelThinkingSuppressionProof } from "./model-thinking-suppression.js";

import { captureCompiledModelRequest } from "./model-invocation-compiled-request.js";
import { COMPILED_PROMPT_PACKAGE_EVENT } from "./compiled-prompt-package.js";

export type SubagentModelPhase = "subagent_turn" | "typed_repair" | "outcome_repair" | "context_compaction";

export interface SubagentModelResponseHooks {
  compiledPrompt?: Parameters<typeof captureCompiledModelRequest>[0]["compiledPrompt"];
  responseEvidence?(response: AssistantMessage): JsonObject;
  onCaptured?(envelope: ModelContextEnvelopeReceipt): void;
}

export interface SubagentModelSession {
  lifetime: ModelSessionLifetime;
  recordProgress?: (delta: SubagentProgress) => Promise<SubagentTask>;
  open(
    phase: SubagentModelPhase,
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
    hooks?: SubagentModelResponseHooks,
  ): Promise<AssistantMessageEventStream>;
}

/** Canonical responses belong to the child; supervisor receipts retain parent linkage. */
export function createSubagentModelSession(input: {
  store: { dataRoot: string; appendEvent(input: AppendEventInput): Promise<RunEvent> } & Pick<RunEventQueryPort, "listRunEvents">;
  models: MutableModels;
  task: SubagentTask;
  limits: SubagentLimits;
  signal?: AbortSignal;
  lifetime?: ModelSessionLifetime;
  child?: SubagentChildExecution;
  modelRoute?: ModelRouteStreamPort;
  modelCalls?: SubagentModelCallScope | undefined;
  assertTurnAvailable?: () => void;
  assertParentBudgetAvailable?: (() => void) | undefined;
  onEvent?: EventSink;
}): SubagentModelSession {
  const lifetime = input.lifetime ?? new SubagentExecutionLifetime(
    input.signal ? [input.signal] : [], input.limits.timeoutMs,
  );
  const settings = readModelRegistryRuntimeSettings(input.models);
  const session = new ModelSession({ models: input.models, lifetime,
    ...(settings?.deadlinePolicy ? { deadlinePolicy: settings.deadlinePolicy } : {}) });
  const shortReasoningThroughCall = new Map<string, number>();
  let modelCallIndex = 0;
  const capsules = new ModelInvocationCapsuleStore(input.store.dataRoot);
  const owner = {
    kind: "subagent" as const,
    threadId: input.task.threadId,
    parentRunId: input.task.runId,
    ...(input.child ? { childRunId: input.child.run.id } : {}),
    taskId: input.task.id,
    ...(input.task.executionId ? { executionId: input.task.executionId } : {}),
  };
  let nextInvocationIndex = 0;
  const append = async (
    type: "subagent.model.invocation" | "subagent.model.response" | "subagent.model.cancellation_failed" | "model.thinking_loop.detected",
    content: Record<string, unknown>,
  ): Promise<void> => {
    const payload = { schemaVersion: 1, owner, taskId: owner.taskId, ...content };
    const eventInput = {
      threadId: owner.threadId,
      runId: type === "model.thinking_loop.detected" ? input.child?.run.id ?? owner.parentRunId : owner.parentRunId,
      visibility: "debug" as const,
      payload: subagentJsonValue({ ...payload, contentSha256: sha256(canonicalJson(payload)) }),
    };
    const event = type === "model.thinking_loop.detected"
      ? await input.store.appendEvent({ ...eventInput, type, category: "model" })
      : await input.store.appendEvent({ ...eventInput, type, category: "subagent" });
    try { await input.onEvent?.(event); } catch {
      // A disconnected observer does not revoke the durable receipt.
    }
  };
  const modelSession: SubagentModelSession = {
    lifetime,
    ...(input.child ? { recordProgress: (delta: SubagentProgress) => input.child!.progress(delta) } : {}),
    async open(phase, model, context, options, hooks) {
      const invocationSignal = AbortSignal.any([lifetime.signal, options?.signal].filter(
        (signal): signal is AbortSignal => Boolean(signal),
      ));
      try {
        lifetime.assertActive();
        invocationSignal.throwIfAborted();
        if (phase !== "context_compaction") {
          input.assertTurnAvailable?.();
          input.child?.assertTurnAvailable();
        }
        input.assertParentBudgetAvailable?.();
        input.child?.assertCanInvoke();
      } catch (error) {
        const denied = subagentModelTurnDeniedStream(model, error, invocationSignal);
        if (denied) return denied;
        throw error;
      }
      let modelAttempt = 0;
      const callIndex = ++modelCallIndex;
      let thinkingRetryUsed = false;
      let overflowRetryUsed = false;
      const invokePhysical = async (candidate: Model<Api>, routedOptions: SimpleStreamOptions,
        invocationContext = context, recoveryAttempt: 0 | 1 = 0,
        failedContext?: Context): Promise<ModelThinkingLoopAttemptSource & { envelope?: ModelContextEnvelopeReceipt }> => {
        modelAttempt += 1;
        let activeContext = invocationContext;
        let activeOptions = routedOptions;
        let compiledPrompt = hooks?.compiledPrompt;
        let reservation;
        try {
          lifetime.assertActive();
          invocationSignal.throwIfAborted();
          if (phase !== "context_compaction") {
            input.assertTurnAvailable?.();
            input.child?.assertTurnAvailable();
          }
          input.assertParentBudgetAvailable?.();
          input.child?.assertCanInvoke();
          if (phase === "subagent_turn" && input.child) {
            const prepared = await prepareSubagentModelInvocation({
              compaction: {
                host: { store: input.store, modelRegistry: { models: input.models }, modelInvocationCapsules: capsules },
                child: input.child, session: modelSession,
                ...(input.onEvent ? { onEvent: input.onEvent } : {}),
              },
              ...(input.modelCalls ? { scope: input.modelCalls } : {}),
              model: candidate, context: invocationContext, options: routedOptions, signal: invocationSignal,
              modelAttempt, recoveryAttempt, ...(input.onEvent ? { onEvent: input.onEvent } : {}),
            });
            activeContext = prepared.context;
            activeOptions = prepared.options;
            compiledPrompt = prepared.compiledPrompt;
          }
          lifetime.assertActive();
          invocationSignal.throwIfAborted();
          input.assertParentBudgetAvailable?.();
          if (recoveryAttempt === 1 && (!failedContext ||
              sha256(canonicalJson(activeContext.messages)) === sha256(canonicalJson(failedContext.messages))))
            throw new Error("Model context overflow recovery did not reduce the request");
          reservation = await input.child?.reserve(phase);
        } catch (error) {
          const denied = subagentModelTurnDeniedStream(candidate, error, invocationSignal);
          if (denied) return { source: denied, context: activeContext, options: routedOptions };
          throw error;
        }
        const invocationIndex = reservation?.invocationIndex ?? ++nextInvocationIndex;
        let contextEnvelopeSha256: string | undefined;
        let envelope: ModelContextEnvelopeReceipt | undefined;
        let capturedToolNames: string[] | undefined;
        let adapter: JsonObject | undefined;
        const opened = await session.open({
          phase,
          ...(input.child && reservation ? { accounting: input.child.accountingForInvocation(reservation) } : {}),
          model: candidate,
          context: activeContext,
          options: phase === "subagent_turn" ? activeOptions : { ...activeOptions, maxRetries: 0 },
          capture: async (request) => {
            const captures: Array<{ kind: string; payload: unknown }> = [];
            const captureInput: ExactModelInvocationCaptureInput = {
              capsules,
              source: { threadId: owner.threadId, runId: input.child?.run.id ?? owner.parentRunId },
              model: request.model,
              context: request.context,
              options: request.options,
              turnIndex: input.child ? invocationIndex - 1 : invocationIndex,
              // The capsule is bound to the actual execution Run. The outer
              // supervisor receipt additionally binds the parent, Task and phase.
              purpose: phase === "context_compaction" ? "context_compaction" : "agent_turn",
              cacheScope: request.cacheScope,
              cacheScopeKind: "session_and_phase",
              phase,
              emit: async (event) => {
                captures.push(event);
                if (event.kind === "adapter") adapter = subagentJsonValue(event.payload) as JsonObject;
              },
            };
            const captured = compiledPrompt ? await captureCompiledModelRequest({
              ...captureInput, compiledPrompt,
              recordCompiledPackage: async (receipt) => {
                const event = await input.store.appendEvent({
                  threadId: owner.threadId, runId: input.child?.run.id ?? owner.parentRunId,
                  type: COMPILED_PROMPT_PACKAGE_EVENT, category: "model", visibility: "debug",
                  payload: subagentJsonValue(receipt),
                });
                try { await input.onEvent?.(event); } catch { /* Durable receipt is authoritative. */ }
              },
            }) : await captureExactModelInvocation(captureInput);
            contextEnvelopeSha256 = captured.envelope.contentSha256;
            envelope = captured.envelope;
            capturedToolNames = (captured.context.tools ?? []).map((tool) => tool.name);
            hooks?.onCaptured?.(envelope);
            await append("subagent.model.invocation", {
              kind: "napier.subagent-model-invocation", phase, invocationIndex,
              contextEnvelopeSha256, captures,
            });
            return captured;
          },
          onCancellationFailure: (failure) => append("subagent.model.cancellation_failed", {
            kind: "napier.subagent-model-cancellation-failure", phase, invocationIndex,
            contextEnvelopeSha256, ...failure,
          }),
          invoke: (invocation, next) => {
            try {
              input.assertParentBudgetAvailable?.();
              input.child?.assertCanInvoke(true);
              return phase === "subagent_turn" && input.modelCalls && input.child && compiledPrompt
                ? input.modelCalls.lifecycle.invoke({
                  run: input.child.run, attempt: modelAttempt, model: invocation.model,
                  context: invocation.context, options: invocation.options ?? {}, compiledPrompt,
                  envelope: invocation.envelope,
                  ...(input.onEvent ? { onEvent: input.onEvent } : {}),
                }, next) : next();
            } catch (error) {
              const denied = subagentModelTurnDeniedStream(candidate, error, invocationSignal);
              if (denied) return denied;
              throw error;
            }
          },
        });
        let settled: Promise<void> | undefined;
        const settleLogical = (message: AssistantMessage, suppressed?: ModelThinkingLoopEvidence,
          proof?: ModelThinkingSuppressionProof): Promise<void> => settled ??= (async () => {
          const attribution = modelResultAttribution(message);
          const usage = hostModelAbortProvenance(message) ? undefined : addSubagentUsage(emptyUsage(), message.usage);
          if (input.child && reservation) {
            const payload = subagentJsonValue({
              ...hooks?.responseEvidence?.(message),
              ...(suppressed ? { outputDisposition: "suppressed_thinking_recovery", thinkingRecovery: suppressed } : {}),
              ...(attribution ? modelAccountingLinkage(attribution) : {}),
              model: `${message.provider}/${message.model}`, stopReason: message.stopReason,
              responseSha256: sha256(canonicalJson(message)),
              ...(envelope ? {
                modelContextEnvelopeSha256: envelope.contentSha256,
                modelContextEnvelopeTurnIndex: envelope.turnIndex,
                modelContextMessageSetSha256: envelope.messageSetSha256,
                modelContextToolDefinitionSetSha256: envelope.toolDefinitionSetSha256,
              } : {}),
              ...(usage ? { usageAccounting: createUsageAccounting({ provider: message.provider, id: message.model }, usage) } : {}),
              toolCalls: message.content.filter((block) => block.type === "toolCall").map((block) => ({
                id: block.id, name: block.name, argumentsSha256: sha256(canonicalJson(block.arguments)),
                argumentsRedacted: true,
              })),
            }) as JsonObject;
            await input.child.settle(reservation.invocationId, payload, usage,
              envelope ? { envelope, ...(adapter ? { adapter } : {}), ...(capturedToolNames ? { toolNames: capturedToolNames } : {}) } : undefined, proof);
          }
          await append("subagent.model.response", {
            ...(attribution ? modelAccountingLinkage(attribution) : {}),
            kind: "napier.subagent-model-response", phase, invocationIndex,
            contextEnvelopeSha256, model: { provider: message.provider, id: message.model },
            responseSha256: sha256(canonicalJson(message)), stopReason: message.stopReason,
            ...(suppressed ? { outputDisposition: "suppressed_thinking_recovery", thinkingRecovery: suppressed } : {}),
            ...(usage ? { usage: message.usage } : { usageStatus: "unknown" }),
          });
        })();
        const attribution = modelResultAttribution(opened.source);
        return { source: opened.source, context: activeContext, options: opened.options ?? activeOptions, settleLogical,
          ...(envelope ? { envelope } : {}),
          logicalResult: () => opened.source.result(),
          recovery: () => ({ ...(opened.recovery ? { handle: opened.recovery } : {}), ...(attribution ? { attribution } : {}) }) };
      };
      const invoke = async (candidate: Model<Api>, routedOptions: SimpleStreamOptions): Promise<AssistantMessageEventStream> => {
        if (phase !== "subagent_turn") {
          const opened = await invokePhysical(candidate, routedOptions);
          return opened.settleLogical ? observeResponse(opened.source, opened.settleLogical) : opened.source;
        }
        let current: ModelThinkingLoopAttemptSource | undefined;
        return guardModelThinkingLoop({ model: candidate, context, options: routedOptions, rootSignal: invocationSignal,
          nativeAccounting: settings?.nativeAccounting !== false,
          remainingMs: () => lifetime.remainingMs(),
          attribution: () => current?.recovery?.().attribution,
          createSource: async ({ attempt, context: priorContext, options: priorOptions, signal, priorEvidence }) => {
            const nextContext = priorEvidence ? { ...priorContext, messages: [...priorContext.messages,
              { role: "user" as const, content: thinkingLoopRetryMessage(priorEvidence), timestamp: Date.now() }] } : priorContext;
            const nextOptions = { ...priorOptions, signal };
            const adjusted = attempt === 1 && (shortReasoningThroughCall.get(`${candidate.provider}/${candidate.id}`) ?? 0) < callIndex
              ? nextOptions : shortThinkingLoopRetryOptions(candidate, nextOptions);
            current = undefined;
            let active = await invokePhysical(candidate, adjusted, nextContext);
            let overflowEventSha256: string | undefined;
            current = {
              get context() { return active.context; },
              get options() { return active.options; },
              logicalResult: () => active.logicalResult?.() ?? active.source.result(),
              recovery: () => active.recovery?.() ?? {},
              settleLogical: (message, evidence, proof) => active.settleLogical?.(message, evidence, proof) ?? Promise.resolve(),
              source: recoverModelContextOverflow({
                source: active.source, signal,
                nativeAccounting: settings?.nativeAccounting !== false,
                remainingMs: () => lifetime.remainingMs(),
                recovery: () => active.recovery?.() ?? {},
                claimRetry: () => { if (overflowRetryUsed) return false; overflowRetryUsed = true; return true; },
                onOverflow: async (error, decision) => {
                  // The hidden error is still a canonical logical response. It
                  // has no thinking-suppression proof and never enters the raw SDK transcript.
                  await active.settleLogical?.(error);
                  if (input.child && active.envelope) {
                    const budget = input.child.createBudget();
                    const evidence = await recordContextOverflow({ host: { store: input.store }, run: input.child.run,
                      budget, ...(input.onEvent ? { onEvent: input.onEvent } : {}) },
                    candidate, error, active.envelope, decision);
                    overflowEventSha256 = evidence.contentSha256;
                    if (decision.action === "retry" && evidence.action !== "retry") return false;
                  }
                },
                onRecoveryStopped: async (readiness) => {
                  if (input.child && overflowEventSha256) await recordContextOverflowStopped({
                    host: { store: input.store }, run: input.child.run, ...(input.onEvent ? { onEvent: input.onEvent } : {}),
                  }, overflowEventSha256, readiness);
                },
                recover: async () => {
                  lifetime.assertActive(); signal.throwIfAborted();
                  active = await invokePhysical(candidate, adjusted, nextContext, 1, active.context);
                  return active.source;
                },
              }),
            };
            return current;
          },
          onDetected: async (evidence, action, _terminal, _trace, recovery) => {
            let effectiveAction: "retry" | "finalize" = action === "retry" && !thinkingRetryUsed ? "retry" : "finalize";
            if (effectiveAction === "retry") {
              try {
                lifetime.assertActive();
                invocationSignal.throwIfAborted();
                input.assertTurnAvailable?.();
                input.assertParentBudgetAvailable?.();
                input.child?.assertTurnAvailable();
                input.child?.assertCanInvoke();
              } catch { effectiveAction = "finalize"; }
            }
            const attribution = current?.recovery?.().attribution;
            await append("model.thinking_loop.detected", { kind: "napier.subagent-thinking-loop",
              phase, action: effectiveAction, ...evidence,
              ...(recovery ? { recoveryReadiness: recovery.readiness, outputDisposition: recovery.outputDisposition } : {}),
              ...(attribution ? modelAccountingLinkage(attribution) : {}),
            });
            if (effectiveAction === "retry") {
              thinkingRetryUsed = true;
              shortReasoningThroughCall.set(`${candidate.provider}/${candidate.id}`, callIndex + 3);
            }
            return effectiveAction;
          },
        });
      };
      // Auxiliary compaction is already inside the chosen route candidate. Its
      // one physical attempt retains that candidate's transport and authority.
      if (!input.modelRoute || phase === "context_compaction") return invoke(model, options ?? {});
      return input.modelRoute.stream({
        signal: invocationSignal,
        ...(phase === "subagent_turn" ? {} : { physicalAttemptLimit: 1 }),
        invoke: (candidate, attempt) => invoke(
          candidate, attempt ? mergeRouteStreamOptions(options ?? {}, attempt.streamOptions) : options ?? {},
        ),
      });
    },
  };
  return modelSession;
}

function observeResponse(
  source: AssistantMessageEventStream,
  observe: (message: AssistantMessage) => Promise<void>,
): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  let observed: Promise<void> | undefined;
  const once = (message: AssistantMessage) => observed ??= observe(message);
  output[Symbol.asyncIterator] = async function* () {
    for await (const event of source) {
      if (event.type === "done" || event.type === "error") {
        await once(event.type === "done" ? event.message : event.error);
      }
      yield event;
    }
    await once(await source.result());
  };
  output.result = async () => {
    const message = await source.result();
    await once(message);
    return message;
  };
  return output;
}
