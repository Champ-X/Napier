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
import type { RunEvent, SubagentLimits, SubagentTask } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import { captureExactModelInvocation } from "./model-invocation-exact-capture.js";
import { ModelInvocationCapsuleStore } from "./model-invocation-capsule-store.js";
import type { ModelRouteStreamPort } from "./model-route-types.js";
import { mergeRouteStreamOptions } from "./model-route-options.js";
import { ModelSession, type ModelSessionLifetime } from "./model-session.js";
import type { AppendEventInput } from "./store-event-service.js";
import { SubagentExecutionLifetime } from "./subagent-execution-lifetime.js";
import { subagentModelTurnDeniedStream } from "./subagent-model-turn-denial.js";
import { subagentJsonValue } from "./subagent-task-evidence.js";

export type SubagentModelPhase = "subagent_turn" | "typed_repair" | "outcome_repair";

export interface SubagentModelSession {
  lifetime: ModelSessionLifetime;
  open(
    phase: SubagentModelPhase,
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): Promise<AssistantMessageEventStream>;
}

/** Child evidence lives in the real parent's ledger, with explicit task ownership. */
export function createSubagentModelSession(input: {
  store: { dataRoot: string; appendEvent(input: AppendEventInput): Promise<RunEvent> };
  models: MutableModels;
  task: SubagentTask;
  limits: SubagentLimits;
  signal?: AbortSignal;
  lifetime?: ModelSessionLifetime;
  modelRoute?: ModelRouteStreamPort;
  assertTurnAvailable?: () => void;
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
  return {
    lifetime,
    async open(phase, model, context, options) {
      lifetime.assertActive();
      if (phase === "subagent_turn") {
        try { input.assertTurnAvailable?.(); } catch (error) {
          const denied = subagentModelTurnDeniedStream(model, error);
          if (denied) return denied;
          throw error;
        }
      }
      const invoke = async (candidate: Model<Api>, routedOptions: SimpleStreamOptions) => {
        lifetime.assertActive();
        const invocationIndex = ++nextInvocationIndex;
        let contextEnvelopeSha256: string | undefined;
        const opened = await session.open({
          phase,
          model: candidate,
          context,
          options: phase === "subagent_turn" ? routedOptions : { ...routedOptions, maxRetries: 0 },
          capture: async (request) => {
            const captures: Array<{ kind: string; payload: unknown }> = [];
            const captured = await captureExactModelInvocation({
              capsules,
              source: { threadId: owner.threadId, runId: owner.parentRunId },
              model: request.model,
              context: request.context,
              options: request.options,
              turnIndex: invocationIndex,
              // Capsule v1 names the real ledger container. The outer receipt
              // binds child owner and phase; main experiment selectors ignore it.
              purpose: "agent_turn",
              cacheScope: request.cacheScope,
              cacheScopeKind: "session_and_phase",
              phase,
              emit: async (event) => { captures.push(event); },
            });
            contextEnvelopeSha256 = captured.envelope.contentSha256;
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
        });
        return observeResponse(opened.source, async (message) => {
          await append("subagent.model.response", {
            kind: "napier.subagent-model-response", phase, invocationIndex,
            contextEnvelopeSha256, model: { provider: message.provider, id: message.model },
            responseSha256: sha256(canonicalJson(message)), stopReason: message.stopReason,
            usage: message.usage,
          });
        });
      };
      if (!input.modelRoute) return invoke(model, options ?? {});
      return input.modelRoute.stream({
        signal: AbortSignal.any([lifetime.signal, options?.signal].filter(
          (signal): signal is AbortSignal => Boolean(signal),
        )),
        ...(phase === "subagent_turn" ? {} : { physicalAttemptLimit: 1 }),
        invoke: (candidate, attempt) => invoke(
          candidate, attempt ? mergeRouteStreamOptions(options ?? {}, attempt.streamOptions) : options ?? {},
        ),
      });
    },
  };
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
