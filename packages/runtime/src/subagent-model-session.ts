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
import { captureExactModelInvocation } from "./model-invocation-exact-capture.js";
import { ModelInvocationCapsuleStore } from "./model-invocation-capsule-store.js";
import type { ModelRouteStreamPort } from "./model-route-types.js";
import { mergeRouteStreamOptions } from "./model-route-options.js";
import { hostModelAbortProvenance } from "./model-abort-provenance.js";
import { ModelSession, type ModelSessionLifetime } from "./model-session.js";
import type { AppendEventInput } from "./store-event-service.js";
import type { RunEventQueryPort } from "./run-event-query-port.js";
import { compactSubagentContext } from "./subagent-context-compaction.js";
import { SubagentExecutionLifetime } from "./subagent-execution-lifetime.js";
import { subagentModelTurnDeniedStream } from "./subagent-model-turn-denial.js";
import { addSubagentUsage, subagentJsonValue } from "./subagent-task-evidence.js";
import type { SubagentChildExecution, SubagentProgress } from "./subagent-child-execution.js";
import { createUsageAccounting } from "./token-accounting.js";

export type SubagentModelPhase = "subagent_turn" | "typed_repair" | "outcome_repair" | "context_compaction";

export interface SubagentModelResponseHooks {
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
  assertTurnAvailable?: () => void;
  assertParentBudgetAvailable?: (() => void) | undefined;
  onEvent?: EventSink;
}): SubagentModelSession {
  const lifetime = input.lifetime ?? new SubagentExecutionLifetime(
    input.signal ? [input.signal] : [], input.limits.timeoutMs,
  );
  const session = new ModelSession({ models: input.models, lifetime });
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
    type: "subagent.model.invocation" | "subagent.model.response" | "subagent.model.cancellation_failed",
    content: Record<string, unknown>,
  ): Promise<void> => {
    const payload = { schemaVersion: 1, owner, taskId: owner.taskId, ...content };
    const event = await input.store.appendEvent({
      threadId: owner.threadId,
      runId: owner.parentRunId,
      type,
      category: "subagent",
      visibility: "debug",
      payload: subagentJsonValue({ ...payload, contentSha256: sha256(canonicalJson(payload)) }),
    });
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
      const invoke = async (candidate: Model<Api>, routedOptions: SimpleStreamOptions) => {
        modelAttempt += 1;
        let activeContext = context;
        let reservation;
        try {
          lifetime.assertActive();
          invocationSignal.throwIfAborted();
          if (phase === "subagent_turn" && input.child) activeContext = await compactSubagentContext({
            host: { store: input.store, modelRegistry: { models: input.models }, modelInvocationCapsules: capsules },
            child: input.child, session: modelSession, model: candidate, context, options: routedOptions, modelAttempt,
            ...(input.onEvent ? { onEvent: input.onEvent } : {}),
          });
          reservation = await input.child?.reserve(phase);
        } catch (error) {
          const denied = subagentModelTurnDeniedStream(candidate, error, invocationSignal);
          if (denied) return denied;
          throw error;
        }
        const invocationIndex = reservation?.invocationIndex ?? ++nextInvocationIndex;
        let contextEnvelopeSha256: string | undefined;
        let envelope: ModelContextEnvelopeReceipt | undefined;
        let adapter: JsonObject | undefined;
        const opened = await session.open({
          phase,
          model: candidate,
          context: activeContext,
          options: phase === "subagent_turn" ? routedOptions : { ...routedOptions, maxRetries: 0 },
          capture: async (request) => {
            const captures: Array<{ kind: string; payload: unknown }> = [];
            const captured = await captureExactModelInvocation({
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
            });
            contextEnvelopeSha256 = captured.envelope.contentSha256;
            envelope = captured.envelope;
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
          invoke: (_invocation, next) => {
            try {
              input.assertParentBudgetAvailable?.();
              input.child?.assertCanInvoke(true);
              return next();
            } catch (error) {
              const denied = subagentModelTurnDeniedStream(candidate, error, invocationSignal);
              if (denied) return denied;
              throw error;
            }
          },
        });
        return observeResponse(opened.source, async (message) => {
          const usage = hostModelAbortProvenance(message) ? undefined : addSubagentUsage(emptyUsage(), message.usage);
          if (input.child && reservation) {
            const payload = subagentJsonValue({
              ...hooks?.responseEvidence?.(message),
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
              envelope ? { envelope, ...(adapter ? { adapter } : {}) } : undefined);
          }
          await append("subagent.model.response", {
            kind: "napier.subagent-model-response", phase, invocationIndex,
            contextEnvelopeSha256, model: { provider: message.provider, id: message.model },
            responseSha256: sha256(canonicalJson(message)), stopReason: message.stopReason,
            ...(usage ? { usage: message.usage } : { usageStatus: "unknown" }),
          });
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
